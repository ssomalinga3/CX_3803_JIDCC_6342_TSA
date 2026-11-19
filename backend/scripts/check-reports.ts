import { randomBytes, randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { eq } from 'drizzle-orm';
import { encode } from 'fast-png';
import { localDatabaseUrl } from './local-config.mjs';
import { withDatabase } from '../src/db/client.js';
import {
  observation,
  reportNotification,
  reportSubmission,
  reportUploadAttempt,
} from '../src/db/schema.js';
import { createS3PhotoStore, s3PhotoConfig } from '../src/modules/reports/s3-photo-store.js';

// Synthetic local-only acceptance check. Never send SMTP or retain the test report.
const database = localDatabaseUrl();
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(database).hostname))
  throw new Error('LOCAL_DATABASE_REQUIRED');
const port = Number(process.env.REPORTING_PORT ?? '8787');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
const base = `http://127.0.0.1:${port}`;
const store = createS3PhotoStore(s3PhotoConfig(process.env));
const id = randomUUID();
const secret = randomBytes(32).toString('hex');
const metadata = {
  client_submission_id: id,
  category_id: 'dev-environmental',
  captured_at: '2026-11-18T12:00:00Z',
  location: null,
  location_unavailable_reason: 'not_shared',
  delivery_mode: 'custom',
  custom_recipients: ['synthetic-check@example.test'],
};
const photo = encode({ width: 1, height: 1, channels: 4, data: new Uint8Array([0, 128, 0, 255]) });
let attempted = false;
let cleanupFailed = false;
try {
  const options = await fetch(`${base}/api/v1/report-options`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!options.ok || !((await options.json()) as { development?: boolean }).development)
    throw new Error('DEVELOPMENT_REPORTING_REQUIRED');
  const submit = async () => {
    const form = new FormData();
    form.set('metadata', JSON.stringify(metadata));
    form.append(
      'images',
      new Blob([new Uint8Array(photo)], { type: 'image/png' }),
      'synthetic.png',
    );
    attempted = true;
    return fetch(`${base}/api/v1/observations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
  };
  const first = await submit();
  if (first.status !== 201) throw new Error('REPORT_ACCEPTANCE_FAILED');
  const receipt = (await first.json()) as { status?: string; observation_id?: string };
  const replay = await submit();
  if (replay.status !== 200 || JSON.stringify(await replay.json()) !== JSON.stringify(receipt))
    throw new Error('REPORT_REPLAY_FAILED');
  await withDatabase(database, async (db) => {
    const [row] = await db.select().from(observation).where(eq(observation.clientSubmissionId, id));
    if (!row || row.observationId !== receipt.observation_id || row.deliveryMode !== 'custom')
      throw new Error('REPORT_PERSISTENCE_FAILED');
    const jobs = await db
      .select()
      .from(reportNotification)
      .where(eq(reportNotification.observationId, row.observationId));
    if (jobs.length !== 1 || jobs[0]!.state !== 'pending' || jobs[0]!.attempts !== 0)
      throw new Error('REPORT_OUTBOX_FAILED');
    const attempts = await db
      .select()
      .from(reportUploadAttempt)
      .where(eq(reportUploadAttempt.clientSubmissionId, id));
    if (
      attempts.length !== 1 ||
      attempts[0]!.state !== 'accepted' ||
      attempts[0]!.objectKeys.length !== 1
    )
      throw new Error('REPORT_ATTEMPT_FAILED');
    for (const key of attempts[0]!.objectKeys) {
      if (!(await store.get(key))) throw new Error('REPORT_PRIVATE_PHOTO_FAILED');
    }
  });
  console.log(
    'PASS: local Worker accepted a private S3 photo, recovered the same receipt and queued one SMTP notification without sending.',
  );
} catch (error) {
  const allowed = new Set([
    'DEVELOPMENT_REPORTING_REQUIRED',
    'REPORT_ACCEPTANCE_FAILED',
    'REPORT_REPLAY_FAILED',
    'REPORT_PERSISTENCE_FAILED',
    'REPORT_OUTBOX_FAILED',
    'REPORT_ATTEMPT_FAILED',
    'REPORT_PRIVATE_PHOTO_FAILED',
  ]);
  console.error(
    error instanceof Error && allowed.has(error.message) ? error.message : 'REPORT_CHECK_FAILED',
  );
  process.exitCode = 1;
} finally {
  if (attempted) {
    try {
      const attempts = await withDatabase(database, (db) =>
        db.select().from(reportUploadAttempt).where(eq(reportUploadAttempt.clientSubmissionId, id)),
      );
      for (const attempt of attempts) for (const key of attempt.objectKeys) await store.delete(key);
      await withDatabase(database, async (db) => {
        await db.delete(observation).where(eq(observation.clientSubmissionId, id));
        await db.delete(reportSubmission).where(eq(reportSubmission.clientSubmissionId, id));
      });
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) {
    console.error('REPORT_CHECK_CLEANUP_REQUIRED');
    process.exitCode = 1;
  } else if (attempted)
    console.log('PASS: synthetic report, notification and private object cleanup completed.');
}
