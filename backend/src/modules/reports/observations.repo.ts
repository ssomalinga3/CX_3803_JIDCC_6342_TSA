import { timingSafeEqual } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { withDatabase } from '../../db/client.js';
import { observation, observationImage } from '../../db/schema.js';

type ReportOwner = { kind: 'account'; accountId: string } | { kind: 'guest'; secretDigest: string };

type ReportLocation =
  | { longitude: number; latitude: number }
  | { reason: 'permission_denied' | 'unavailable' | 'not_shared' };

type ReportDestination =
  | { mode: 'park'; recipient: string }
  | { mode: 'custom'; recipients: readonly [string, ...string[]] };

/** Internal input from the future validated submission and private-media boundary. */
export type PreparedObservation = {
  clientSubmissionId: string;
  owner: ReportOwner;
  /** Digest of normalized request fields and ordered upload hashes, before routing. */
  payloadDigest: string;
  categoryId: string;
  capturedAt: Date;
  location: ReportLocation;
  note?: string;
  destination: ReportDestination;
  /** Private object keys in the original upload order. */
  objectKeys: readonly string[];
};

const receiptFields = {
  observationId: observation.observationId,
  clientSubmissionId: observation.clientSubmissionId,
  acceptedAt: observation.acceptedAt,
};

type Receipt = Pick<typeof observation.$inferSelect, keyof typeof receiptFields>;
type Acceptance =
  { kind: 'created' | 'replay'; receipt: Receipt } | { kind: 'conflict' | 'unavailable' };

function ownsReport(
  owner: ReportOwner,
  stored: Pick<typeof observation.$inferSelect, 'accountId' | 'guestSecretDigest'>,
): boolean {
  if (owner.kind === 'account') return stored.accountId === owner.accountId;
  return (
    stored.guestSecretDigest !== null &&
    /^[0-9a-f]{64}$/.test(owner.secretDigest) &&
    timingSafeEqual(
      Buffer.from(stored.guestSecretDigest, 'hex'),
      Buffer.from(owner.secretDigest, 'hex'),
    )
  );
}

/** Persists finalized rows only. Upload leases and notification outbox belong to downstream work. */
export async function acceptObservation(
  connectionString: string,
  report: PreparedObservation,
): Promise<Acceptance> {
  return withDatabase(connectionString, (db) =>
    db.transaction(
      async (tx): Promise<Acceptance> => {
        const { owner, location, destination } = report;
        const [receipt] = await tx
          .insert(observation)
          .values({
            clientSubmissionId: report.clientSubmissionId,
            accountId: owner.kind === 'account' ? owner.accountId : null,
            guestSecretDigest: owner.kind === 'guest' ? owner.secretDigest : null,
            payloadDigest: report.payloadDigest,
            categoryId: report.categoryId,
            capturedAt: report.capturedAt,
            location:
              'reason' in location
                ? null
                : sql`ST_SetSRID(ST_MakePoint(${location.longitude}, ${location.latitude}), 4326)`,
            locationUnavailableReason: 'reason' in location ? location.reason : null,
            note: report.note,
            deliveryMode: destination.mode,
            recipients:
              destination.mode === 'park' ? [destination.recipient] : [...destination.recipients],
          })
          .onConflictDoNothing({ target: observation.clientSubmissionId })
          .returning(receiptFields);

        if (receipt) {
          if (report.objectKeys.length > 0) {
            await tx.insert(observationImage).values(
              report.objectKeys.map((objectKey, position) => ({
                observationId: receipt.observationId,
                position,
                objectKey,
              })),
            );
          }
          return { kind: 'created', receipt };
        }

        // READ COMMITTED gives this statement a fresh snapshot after a competing insert commits.
        const [stored] = await tx
          .select({
            ...receiptFields,
            accountId: observation.accountId,
            guestSecretDigest: observation.guestSecretDigest,
            payloadDigest: observation.payloadDigest,
          })
          .from(observation)
          .where(eq(observation.clientSubmissionId, report.clientSubmissionId));
        if (!stored || !ownsReport(owner, stored)) return { kind: 'unavailable' };
        if (stored.payloadDigest !== report.payloadDigest) return { kind: 'conflict' };
        return {
          kind: 'replay',
          receipt: {
            observationId: stored.observationId,
            clientSubmissionId: stored.clientSubmissionId,
            acceptedAt: stored.acceptedAt,
          },
        };
      },
      { isolationLevel: 'read committed' },
    ),
  );
}
