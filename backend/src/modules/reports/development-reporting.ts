import { createReportSubmissionService } from './submissions.js';
import { createSubmissionsRepository } from './submissions.repo.js';
import { DEVELOPMENT_REPORT_CATEGORIES } from './report-input.js';
import { createS3PhotoStore, s3PhotoConfig } from './s3-photo-store.js';

/** Explicit development opt-in only. Production has no implicit catalog, routing or writes. */
export function developmentReporting(
  bindings: Record<string, unknown>,
  connectionString: () => string,
) {
  if (bindings.REPORTING_MODE !== 'custom-development') return undefined;
  const config = () =>
    s3PhotoConfig(
      Object.fromEntries(
        [
          'AWS_REGION',
          'S3_BUCKET',
          'AWS_ACCESS_KEY_ID',
          'AWS_SECRET_ACCESS_KEY',
          'AWS_SESSION_TOKEN',
        ].map((key) => [
          key,
          typeof bindings[key] === 'string' ? (bindings[key] as string) : undefined,
        ]),
      ),
    );
  // S3/Hyperdrive operations are initialized inside a request, never during Worker startup.
  let store: ReturnType<typeof createS3PhotoStore> | undefined;
  const photos = () => (store ??= createS3PhotoStore(config()));
  return createReportSubmissionService({
    repository: createSubmissionsRepository(connectionString, 120_000),
    photos: {
      put: (key, photo) => photos().put(key, photo),
      get: (key) => photos().get(key),
      delete: (key) => photos().delete(key),
      presignGet: (key, seconds) => photos().presignGet(key, seconds),
    },
    categories: DEVELOPMENT_REPORT_CATEGORIES,
    development: true,
  });
}
