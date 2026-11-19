import { timingSafeEqual } from 'node:crypto';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { withDatabase } from '../../db/client.js';
import {
  observation,
  observationImage,
  reportNotification,
  reportSubmission,
  reportUploadAttempt,
} from '../../db/schema.js';
import {
  acceptObservationInTransaction,
  type PreparedObservation,
  type Receipt,
} from './observations.repo.js';
import { ReportError } from './report-input.js';

export type SubmissionIdentity = {
  submissionId: string;
  guestDigest: string;
  payloadDigest: string;
};
type Database = Pick<NodePgDatabase, 'select' | 'insert' | 'update' | 'execute'>;

function sameDigest(a: string | null, b: string): boolean {
  return (
    a !== null &&
    /^[0-9a-f]{64}$/.test(a) &&
    /^[0-9a-f]{64}$/.test(b) &&
    timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  );
}

async function lock(db: Database, id: string) {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`);
}

async function accepted(db: Database, identity: SubmissionIdentity): Promise<Receipt | undefined> {
  const [row] = await db
    .select({
      observationId: observation.observationId,
      clientSubmissionId: observation.clientSubmissionId,
      acceptedAt: observation.acceptedAt,
      guestDigest: observation.guestSecretDigest,
      payloadDigest: observation.payloadDigest,
    })
    .from(observation)
    .where(eq(observation.clientSubmissionId, identity.submissionId));
  if (!row) return undefined;
  if (!sameDigest(row.guestDigest, identity.guestDigest)) throw new ReportError('NOT_FOUND', 404);
  if (row.payloadDigest !== identity.payloadDigest)
    throw new ReportError('SUBMISSION_CONFLICT', 409);
  return {
    observationId: row.observationId,
    clientSubmissionId: row.clientSubmissionId,
    acceptedAt: row.acceptedAt,
  };
}

export function createSubmissionsRepository(connectionString: () => string, leaseMs: number) {
  if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 600_000)
    throw new Error('Invalid upload lease configuration');
  return {
    async begin(
      identity: SubmissionIdentity,
    ): Promise<{ attemptId: string } | { receipt: Receipt }> {
      return withDatabase(connectionString(), (db) =>
        db.transaction(async (tx) => {
          await lock(tx, identity.submissionId);
          const receipt = await accepted(tx, identity);
          if (receipt) return { receipt };
          const [existing] = await tx
            .select()
            .from(reportSubmission)
            .where(eq(reportSubmission.clientSubmissionId, identity.submissionId));
          if (existing) {
            if (!sameDigest(existing.guestSecretDigest, identity.guestDigest))
              throw new ReportError('NOT_FOUND', 404);
            if (existing.payloadDigest !== identity.payloadDigest)
              throw new ReportError('SUBMISSION_CONFLICT', 409);
          } else {
            await tx.insert(reportSubmission).values({
              clientSubmissionId: identity.submissionId,
              guestSecretDigest: identity.guestDigest,
              payloadDigest: identity.payloadDigest,
            });
          }
          const [active] = await tx
            .select({ expires: reportUploadAttempt.leaseExpiresAt })
            .from(reportUploadAttempt)
            .where(
              and(
                eq(reportUploadAttempt.clientSubmissionId, identity.submissionId),
                eq(reportUploadAttempt.state, 'uploading'),
                gt(reportUploadAttempt.leaseExpiresAt, sql`clock_timestamp()`),
              ),
            );
          if (active)
            throw new ReportError(
              'SUBMISSION_IN_PROGRESS',
              409,
              {},
              Math.max(1, Math.ceil((active.expires.getTime() - Date.now()) / 1000)),
            );
          // Invalidating the old attempt prevents a late writer from ever accepting its objects.
          await tx
            .update(reportUploadAttempt)
            .set({ state: 'abandoned' })
            .where(
              and(
                eq(reportUploadAttempt.clientSubmissionId, identity.submissionId),
                eq(reportUploadAttempt.state, 'uploading'),
              ),
            );
          const [attempt] = await tx
            .insert(reportUploadAttempt)
            .values({
              clientSubmissionId: identity.submissionId,
              leaseExpiresAt: sql`clock_timestamp() + (${leaseMs} * interval '1 millisecond')`,
            })
            .returning({ attemptId: reportUploadAttempt.attemptId });
          return { attemptId: attempt!.attemptId };
        }),
      );
    },

    /** Commit each object intent before calling S3, including writes with a lost acknowledgement. */
    async recordObject(attemptId: string, objectKey: string): Promise<void> {
      await withDatabase(connectionString(), (db) =>
        db.transaction(async (tx) => {
          const [attempt] = await tx
            .select()
            .from(reportUploadAttempt)
            .where(eq(reportUploadAttempt.attemptId, attemptId));
          if (!attempt) throw new ReportError('SUBMISSION_LEASE_EXPIRED', 409, {}, 1);
          await lock(tx, attempt.clientSubmissionId);
          const [updated] = await tx
            .update(reportUploadAttempt)
            .set({
              objectKeys: sql`array_append(${reportUploadAttempt.objectKeys}, ${objectKey}::uuid)`,
            })
            .where(
              and(
                eq(reportUploadAttempt.attemptId, attemptId),
                eq(reportUploadAttempt.state, 'uploading'),
                gt(reportUploadAttempt.leaseExpiresAt, sql`clock_timestamp()`),
                sql`cardinality(${reportUploadAttempt.objectKeys}) < 3`,
                sql`NOT (${objectKey}::uuid = ANY(${reportUploadAttempt.objectKeys}))`,
              ),
            )
            .returning({ id: reportUploadAttempt.attemptId });
          if (!updated) throw new ReportError('SUBMISSION_LEASE_EXPIRED', 409, {}, 1);
        }),
      );
    },

    async finish(
      identity: SubmissionIdentity,
      attemptId: string,
      report: PreparedObservation,
    ): Promise<Receipt> {
      return withDatabase(connectionString(), (db) =>
        db.transaction(async (tx) => {
          await lock(tx, identity.submissionId);
          const receipt = await accepted(tx, identity);
          if (receipt) return receipt;
          const [attempt] = await tx
            .select()
            .from(reportUploadAttempt)
            .where(
              and(
                eq(reportUploadAttempt.attemptId, attemptId),
                eq(reportUploadAttempt.clientSubmissionId, identity.submissionId),
                eq(reportUploadAttempt.state, 'uploading'),
                gt(reportUploadAttempt.leaseExpiresAt, sql`clock_timestamp()`),
              ),
            );
          if (!attempt) throw new ReportError('SUBMISSION_LEASE_EXPIRED', 409, {}, 1);
          if (
            report.owner.kind !== 'guest' ||
            !sameDigest(report.owner.secretDigest, identity.guestDigest) ||
            report.clientSubmissionId !== identity.submissionId ||
            report.payloadDigest !== identity.payloadDigest ||
            report.destination.mode !== 'custom' ||
            report.objectKeys.length < 1 ||
            JSON.stringify(attempt.objectKeys) !== JSON.stringify(report.objectKeys)
          )
            throw new ReportError('REPORT_UNAVAILABLE', 503);
          const result = await acceptObservationInTransaction(tx, report);
          if (!('receipt' in result)) throw new ReportError('REPORT_UNAVAILABLE', 503);
          await tx
            .insert(reportNotification)
            .values(
              report.destination.recipients.map((recipient) => ({
                observationId: result.receipt.observationId,
                recipient,
              })),
            )
            .onConflictDoNothing();
          await tx
            .update(reportUploadAttempt)
            .set({ state: 'accepted' })
            .where(eq(reportUploadAttempt.attemptId, attemptId));
          return result.receipt;
        }),
      );
    },

    /** Resolve an uncertain commit before authorizing any failed-attempt cleanup. */
    async abandon(
      identity: SubmissionIdentity,
      attemptId: string,
    ): Promise<{ receipt?: Receipt; keys: string[] }> {
      return withDatabase(connectionString(), (db) =>
        db.transaction(async (tx) => {
          await lock(tx, identity.submissionId);
          const receipt = await accepted(tx, identity);
          const [attempt] = await tx
            .select()
            .from(reportUploadAttempt)
            .where(
              and(
                eq(reportUploadAttempt.attemptId, attemptId),
                eq(reportUploadAttempt.clientSubmissionId, identity.submissionId),
              ),
            );
          if (!attempt || attempt.state === 'accepted') return { receipt, keys: [] };
          await tx
            .update(reportUploadAttempt)
            .set({ state: 'abandoned' })
            .where(eq(reportUploadAttempt.attemptId, attemptId));
          const referenced = attempt.objectKeys.length
            ? await tx
                .select({ key: observationImage.objectKey })
                .from(observationImage)
                .where(inArray(observationImage.objectKey, attempt.objectKeys))
            : [];
          const keep = new Set(referenced.map((row) => row.key));
          return { receipt, keys: attempt.objectKeys.filter((key) => !keep.has(key)) };
        }),
      );
    },
  };
}

export type SubmissionsRepository = ReturnType<typeof createSubmissionsRepository>;
