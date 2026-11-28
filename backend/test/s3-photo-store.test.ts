import { mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  createS3PhotoStore,
  s3PhotoConfig,
  type S3PhotoConfig,
} from '../src/modules/reports/s3-photo-store.js';
import { createPhotoService } from '../src/modules/reports/photo-storage.js';
import { preparePhoto } from '../src/modules/reports/photos.js';
import { samplePng, upload } from './fixtures/photos.js';

// Synthetic SDK credentials only; these tests never read backend/.env or call AWS.
const config: S3PhotoConfig = {
  region: 'us-east-2',
  bucket: 'photo-test-private',
  accessKeyId: 'TESTACCESSKEY',
  secretAccessKey: 'test-secret-not-a-real-credential',
};
const context = { submissionId: randomUUID(), guestSecret: '1'.repeat(64) };

describe('AWS SDK private photo adapter', () => {
  afterEach(() => mock.restoreAll());

  function fakeS3() {
    const objects = new Map<string, { bytes: Uint8Array; headers: Headers }>();
    const calls: Request[] = [];
    const fetch = mock.method(
      globalThis,
      'fetch',
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        calls.push(request);
        const key = new URL(request.url).pathname;
        if (request.method === 'PUT') {
          if (objects.has(key))
            return new Response('<Error><Code>PreconditionFailed</Code></Error>', { status: 412 });
          objects.set(key, {
            bytes: new Uint8Array(await request.arrayBuffer()),
            headers: request.headers,
          });
          return new Response('', { status: 200 });
        }
        if (request.method === 'DELETE') {
          objects.delete(key);
          return new Response(null, { status: 204 });
        }
        const stored = objects.get(key);
        if (!stored)
          return new Response('<Error><Code>NoSuchKey</Code></Error>', {
            status: 404,
            headers: { 'content-type': 'application/xml' },
          });
        const headers = new Headers(stored.headers);
        headers.set('content-length', String(stored.bytes.byteLength));
        return new Response(Buffer.from(stored.bytes), { headers });
      },
    );
    return { objects, calls, fetch };
  }

  it('uses encrypted, create-only private writes and stable keys, with owner-checked expiring downloads', async () => {
    const { calls, objects } = fakeS3();
    const store = createS3PhotoStore(config),
      service = createPhotoService(store);
    const [photo] = await service.stage(context, [upload()]);
    const put = calls.find((call) => call.method === 'PUT')!;
    expect(put.headers.get('if-none-match')).toBe('*');
    expect(put.headers.get('x-amz-server-side-encryption')).toBe('AES256');
    expect(put.headers.get('x-amz-acl')).toBeNull();
    expect(put.headers.get('cache-control')).toBe('private, no-store');
    expect(put.headers.get('content-type')).toBe('image/png');
    expect(put.headers.get('authorization')).toContain('AWS4-HMAC-SHA256');
    expect(put.headers.get('x-amz-meta-owner-digest')).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify([...put.headers])).not.toContain(context.guestSecret);
    const local = await service.issueAccess(context, photo!.objectKey, 1000);
    expect((await service.read(context, local)).sha256).toBe(photo!.sha256);
    const url = new URL(await service.issueDownload(context, photo!.objectKey, 60));
    expect(url.protocol).toBe('https:');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(url.pathname).toBe(`/report-photos/${photo!.objectKey}`);
    expect(url.searchParams.get('response-cache-control')).toBe('private, no-store');
    expect(url.toString()).not.toContain(context.guestSecret);
    await expect(
      service.issueDownload({ ...context, guestSecret: '2'.repeat(64) }, photo!.objectKey, 60),
    ).rejects.toMatchObject({ code: 'PHOTO_UNAVAILABLE' });
    await expect(service.issueDownload(context, photo!.objectKey, 301)).rejects.toMatchObject({
      code: 'PHOTO_UNAVAILABLE',
    });
    await expect(
      store.put(photo!.objectKey, {
        ...(await preparePhoto(samplePng())),
        ownerDigest: '0'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'PHOTO_OBJECT_EXISTS' });
    await service.discard(context, [photo!.objectKey]);
    expect(objects.size).toBe(0);
    await expect(store.get(photo!.objectKey)).resolves.toBeNull();
    await service.discard(context, [photo!.objectKey]);
  });

  it('rejects traversal before making an AWS request', async () => {
    const { calls } = fakeS3();
    const store = createS3PhotoStore(config);
    for (const key of ['../other', 'report-photos/anything', '/secret']) {
      await expect(store.get(key)).rejects.toMatchObject({ code: 'PHOTO_UNAVAILABLE' });
      await expect(store.delete(key)).rejects.toMatchObject({ code: 'PHOTO_UNAVAILABLE' });
      await expect(store.presignGet(key, 60)).rejects.toMatchObject({ code: 'PHOTO_UNAVAILABLE' });
    }
    expect(calls).toEqual([]);
  });

  it('fails closed on missing/invalid metadata, excess size and corrupt stored bytes', async () => {
    const { objects } = fakeS3(),
      store = createS3PhotoStore(config);
    const photo = await preparePhoto(samplePng()),
      key = randomUUID();
    const original = { ...photo, ownerDigest: '1'.repeat(64) };
    for (const mutate of [
      (entry: { bytes: Uint8Array; headers: Headers }) =>
        entry.headers.delete('x-amz-meta-owner-digest'),
      (entry: { bytes: Uint8Array; headers: Headers }) =>
        entry.headers.set('content-type', 'text/html'),
      (entry: { bytes: Uint8Array; headers: Headers }) =>
        entry.headers.set('x-amz-meta-sha256', '0'.repeat(64)),
      (entry: { bytes: Uint8Array; headers: Headers }) =>
        entry.headers.set('x-amz-meta-width', '4097'),
      (entry: { bytes: Uint8Array; headers: Headers }) => {
        entry.bytes = Buffer.alloc(5 * 1024 * 1024 + 1);
      },
    ]) {
      await store.put(key, original);
      mutate(objects.get(`/report-photos/${key}`)!);
      await expect(store.get(key)).rejects.toMatchObject({ code: 'PHOTO_STORAGE_UNAVAILABLE' });
      await store.delete(key);
    }
  });

  it('returns fixed service errors for AWS failures without leaking dependency details', async () => {
    mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(
          '<Error><Code>AccessDenied</Code><Message>private-server-details</Message></Error>',
          { status: 403, headers: { 'content-type': 'application/xml' } },
        ),
    );
    const service = createPhotoService(createS3PhotoStore(config));
    await expect(service.stage(context, [upload()])).rejects.toMatchObject({
      message: 'PHOTO_CLEANUP_REQUIRED',
    });
    await expect(service.issueDownload(context, randomUUID(), 60)).rejects.toMatchObject({
      message: 'PHOTO_STORAGE_UNAVAILABLE',
    });
  });

  it('requires explicit server configuration without echoing missing credentials', () => {
    expect(() => s3PhotoConfig({ AWS_SECRET_ACCESS_KEY: 'private-secret' })).toThrow(
      'S3_PHOTO_CONFIG_REQUIRED',
    );
    expect(
      s3PhotoConfig({
        AWS_REGION: config.region,
        S3_BUCKET: config.bucket,
        AWS_ACCESS_KEY_ID: config.accessKeyId,
        AWS_SECRET_ACCESS_KEY: config.secretAccessKey,
      }),
    ).toEqual(config);
  });
});
