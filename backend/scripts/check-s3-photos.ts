import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { GetPublicAccessBlockCommand } from '@aws-sdk/client-s3';
import { encode } from 'fast-png';
import {
  createS3PhotoClient,
  createS3PhotoStore,
  s3PhotoConfig,
} from '../src/modules/reports/s3-photo-store.js';
import { createPhotoService } from '../src/modules/reports/photo-storage.js';
import { PhotoError } from '../src/modules/reports/photo-errors.js';

const write = process.argv.includes('--write');
let cleanup: (() => Promise<void>) | undefined;
let operation = 'configuration';
try {
  const config = s3PhotoConfig(process.env),
    client = createS3PhotoClient(config);
  operation = 'public-access-block';
  const block = (await client.send(new GetPublicAccessBlockCommand({ Bucket: config.bucket })))
    .PublicAccessBlockConfiguration;
  if (
    !block?.BlockPublicAcls ||
    !block.IgnorePublicAcls ||
    !block.BlockPublicPolicy ||
    !block.RestrictPublicBuckets
  ) {
    throw new Error('S3_PUBLIC_ACCESS_BLOCK_REQUIRED');
  }
  console.log('PASS: bucket access and all four bucket public-access blocks.');
  if (write) {
    operation = 'synthetic-object-check';
    const service = createPhotoService(createS3PhotoStore(config, client));
    const context = { submissionId: randomUUID(), guestSecret: randomBytes(32).toString('hex') };
    const bytes = encode({
      width: 2,
      height: 1,
      channels: 4,
      data: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255]),
      text: { Test: 'synthetic-private-marker' },
    });
    const photos = await service.stage(context, [
      (async function* () {
        yield bytes;
      })(),
    ]);
    const objectKey = photos[0]!.objectKey;
    cleanup = () => service.discard(context, [objectKey]);
    const url = await service.issueDownload(context, objectKey, 1);
    const authorized = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (authorized.status !== 200) throw new Error('S3_SIGNED_READ_FAILED');
    const sanitized = Buffer.from(await authorized.arrayBuffer());
    if (sanitized.includes(Buffer.from('synthetic-private-marker')))
      throw new Error('S3_SANITIZATION_FAILED');
    const anonymousUrl = new URL(url);
    anonymousUrl.search = '';
    const anonymous = await fetch(anonymousUrl, { signal: AbortSignal.timeout(15000) });
    await anonymous.body?.cancel();
    if (![403, 404].includes(anonymous.status)) throw new Error('S3_ANONYMOUS_READ_NOT_DENIED');
    try {
      await service.issueDownload({ ...context, guestSecret: '0'.repeat(64) }, objectKey, 1);
      throw new Error('S3_OWNER_ISOLATION_FAILED');
    } catch (error) {
      if (!(error instanceof PhotoError) || error.code !== 'PHOTO_UNAVAILABLE') throw error;
    }
    await delay(2200);
    const expired = await fetch(url, { signal: AbortSignal.timeout(15000) });
    await expired.body?.cancel();
    if (expired.status !== 403) throw new Error('S3_EXPIRY_NOT_ENFORCED');
    const deletionProbe = await service.issueDownload(context, objectKey, 60);
    await cleanup();
    cleanup = undefined;
    const deleted = await fetch(deletionProbe, { signal: AbortSignal.timeout(15000) });
    await deleted.body?.cancel();
    if (![403, 404].includes(deleted.status)) throw new Error('S3_DELETION_NOT_CONFIRMED');
    console.log(
      'PASS: synthetic private upload/read, sanitization, owner isolation, anonymous denial, signed expiry and deletion.',
    );
  }
} catch (error) {
  // Never print SDK errors, URLs, credentials, object keys or server XML.
  const code =
    error instanceof Error && /^(S3_[A-Z_]+|PHOTO_[A-Z_]+)$/.test(error.message)
      ? error.message
      : 'S3_CHECK_FAILED';
  console.error(code);
  const allowedNames = [
    'TypeError',
    'AccessDenied',
    'InvalidAccessKeyId',
    'SignatureDoesNotMatch',
    'ExpiredToken',
    'Forbidden',
    'NotFound',
    'NoSuchBucket',
    'PermanentRedirect',
    'TimeoutError',
  ];
  const name =
    error instanceof Error && allowedNames.includes(error.name) ? error.name : 'REQUEST_FAILED';
  console.error(`Check stage: ${operation}; category: ${name}. No request details printed.`);
  if (error && typeof error === 'object' && '$metadata' in error) {
    const status = (error.$metadata as { httpStatusCode?: number }).httpStatusCode;
    if (Number.isInteger(status)) console.error(`HTTP status: ${status}`);
  }
  if (
    error &&
    typeof error === 'object' &&
    'cause' in error &&
    error.cause &&
    typeof error.cause === 'object' &&
    'code' in error.cause
  ) {
    const allowed = [
      'ENOTFOUND',
      'ECONNREFUSED',
      'ENETUNREACH',
      'ETIMEDOUT',
      'CERT_HAS_EXPIRED',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
    ];
    if (allowed.includes(String(error.cause.code)))
      console.error(`Transport category: ${error.cause.code}`);
  }
  process.exitCode = 1;
} finally {
  if (cleanup) {
    try {
      await cleanup();
    } catch {
      console.error('S3_TEST_CLEANUP_REQUIRED');
      process.exitCode = 1;
    }
  }
}
