import { URL } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { localDatabaseUrl } from './local-config.mjs';
import { withDatabase } from '../src/db/client.js';
import {
  observation,
  observationImage,
  reportNotification,
  reportSubmission,
  reportUploadAttempt,
} from '../src/db/schema.js';
import { createS3PhotoStore, s3PhotoConfig } from '../src/modules/reports/s3-photo-store.js';

// Verify/clean only explicitly marked synthetic native acceptance fixtures, never visitor reports.
const [id, flag, extra] = process.argv.slice(2);
if (
  !id ||
  !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id) ||
  (flag && flag !== '--cleanup') ||
  extra
)
  throw new Error('Usage: reports:mobile:check <synthetic-observation-uuid> [--cleanup]');
const database = localDatabaseUrl();
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(database).hostname))
  throw new Error('LOCAL_DATABASE_REQUIRED');
try {
  const state = await withDatabase(database, async (db) => {
    const [row] = await db.select().from(observation).where(eq(observation.observationId, id));
    if (
      !row ||
      !/^J6-31 (iOS|Android) synthetic smoke \d{8}-[A-Z]$/.test(row.note ?? '') ||
      row.deliveryMode !== 'custom' ||
      row.recipients.length !== 1 ||
      !/^synthetic-(ios|android)@example\.test$/.test(row.recipients[0]!)
    )
      throw new Error();
    const sameNote = await db.select().from(observation).where(eq(observation.note, row.note!));
    const photos = await db
      .select()
      .from(observationImage)
      .where(eq(observationImage.observationId, id));
    const jobs = await db
      .select()
      .from(reportNotification)
      .where(eq(reportNotification.observationId, id));
    const attempts = await db
      .select()
      .from(reportUploadAttempt)
      .where(eq(reportUploadAttempt.clientSubmissionId, row.clientSubmissionId));
    if (
      sameNote.length !== 1 ||
      photos.length < 1 ||
      photos.length > 3 ||
      jobs.length !== 1 ||
      jobs[0]!.recipient !== row.recipients[0] ||
      jobs[0]!.state !== 'pending' ||
      jobs[0]!.attempts !== 0 ||
      attempts.filter((attempt) => attempt.state === 'accepted').length !== 1
    )
      throw new Error();
    return { row, photos, attempts };
  });
  const store = createS3PhotoStore(s3PhotoConfig(process.env));
  for (const photo of state.photos) {
    const stored = await store.get(photo.objectKey);
    if (!stored || stored.contentType !== 'image/jpeg' || stored.bytes.byteLength < 1)
      throw new Error();
  }
  console.log(
    'PASS: one native synthetic observation, private JPEG attachments and one unsent custom notification.',
  );
  if (flag === '--cleanup') {
    const keys = new Set([
      ...state.photos.map((photo) => photo.objectKey),
      ...state.attempts.flatMap((attempt) => attempt.objectKeys),
    ]);
    for (const key of keys) await store.delete(key);
    await withDatabase(database, (db) =>
      db.transaction(async (tx) => {
        await tx
          .delete(observation)
          .where(and(eq(observation.observationId, id), eq(observation.note, state.row.note!)));
        await tx
          .delete(reportSubmission)
          .where(eq(reportSubmission.clientSubmissionId, state.row.clientSubmissionId));
      }),
    );
    console.log(
      'PASS: synthetic native report objects, pending notification and acceptance records removed.',
    );
  }
} catch {
  console.error('SYNTHETIC_MOBILE_REPORT_CHECK_FAILED');
  process.exitCode = 1;
}
