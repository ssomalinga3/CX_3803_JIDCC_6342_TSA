import { createHash } from 'node:crypto';
import { createPhotoService, type PrivatePhotoStore } from './photo-storage.js';
import { reportMetadata, ReportError } from './report-input.js';
import type { SubmissionsRepository } from './submissions.repo.js';
import type { PreparedObservation, Receipt } from './observations.repo.js';

export type ReportCategory = { category_id: string; name: string; pillar: string };

export function createReportSubmissionService(options: {
  repository: SubmissionsRepository;
  photos: PrivatePhotoStore;
  categories: readonly ReportCategory[];
  development: boolean;
}) {
  const { repository, photos } = options;
  return {
    options() {
      return {
        development: options.development,
        delivery_modes: ['custom'],
        categories: options.categories,
      };
    },

    async submit(
      raw: unknown,
      images: readonly Uint8Array[],
      secret: string,
    ): Promise<{ created: boolean; receipt: Receipt }> {
      if (!/^[0-9a-f]{64}$/.test(secret)) throw new ReportError('UNAUTHORIZED', 401);
      const metadata = reportMetadata(raw);
      if (images.length < 1 || images.length > 3) throw new ReportError('INVALID_PHOTO_COUNT', 400);
      const payloadDigest = createHash('sha256')
        .update(
          JSON.stringify({
            metadata,
            images: images.map((bytes) => createHash('sha256').update(bytes).digest('hex')),
          }),
        )
        .digest('hex');
      const identity = {
        submissionId: metadata.client_submission_id,
        guestDigest: createHash('sha256').update(Buffer.from(secret, 'hex')).digest('hex'),
        payloadDigest,
      };
      const begun = await repository.begin(identity);
      if ('receipt' in begun) return { created: false, receipt: begun.receipt };
      const { attemptId } = begun;
      const context = { submissionId: identity.submissionId, guestSecret: secret };
      // Journal the key before every external write, and verify the lease is still live.
      const stagedPhotos = createPhotoService({
        async put(key, photo) {
          await repository.recordObject(attemptId, key);
          await photos.put(key, photo);
        },
        get: (key) => photos.get(key),
        delete: (key) => photos.delete(key),
      });
      try {
        if (!options.categories.some((category) => category.category_id === metadata.category_id)) {
          throw new ReportError('INVALID_REPORT', 400, {
            category_id: 'Choose an available report category.',
          });
        }
        const uploaded = await stagedPhotos.stage(
          context,
          images.map((bytes) =>
            (async function* () {
              yield bytes;
            })(),
          ),
        );
        const report: PreparedObservation = {
          clientSubmissionId: identity.submissionId,
          owner: { kind: 'guest', secretDigest: identity.guestDigest },
          payloadDigest,
          categoryId: metadata.category_id,
          capturedAt: new Date(metadata.captured_at),
          note: metadata.note,
          location: metadata.location
            ? {
                longitude: metadata.location.coordinates[0],
                latitude: metadata.location.coordinates[1],
              }
            : { reason: metadata.location_unavailable_reason! },
          destination: {
            mode: 'custom',
            recipients: metadata.custom_recipients as [string, ...string[]],
          },
          objectKeys: uploaded.map((photo) => photo.objectKey),
        };
        return { created: true, receipt: await repository.finish(identity, attemptId, report) };
      } catch (error) {
        // A DB error may mean the commit succeeded but its response was lost. Never delete first.
        const resolution = await repository.abandon(identity, attemptId);
        for (const key of resolution.keys) {
          try {
            await stagedPhotos.discard(context, [key]);
          } catch {
            /* Durable abandoned-attempt intent remains available for later cleanup/reconciliation. */
          }
        }
        if (resolution.receipt) return { created: false, receipt: resolution.receipt };
        throw error;
      }
    },
  };
}

export type ReportSubmissionService = ReturnType<typeof createReportSubmissionService>;
