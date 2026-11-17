import { mkdtemp, readdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLocalPhotoStore } from '../scripts/local-photo-store.js';
import { createPhotoService } from '../src/modules/reports/photo-storage.js';
import { samplePng, upload } from './fixtures/photos.js';

describe('private local photo store', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cascade-photo-test-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('persists complete objects across adapter restarts with private filesystem permissions', async () => {
    const context = { submissionId: randomUUID(), guestSecret: '1'.repeat(64) };
    const service = createPhotoService(await createLocalPhotoStore(root));
    const [photo] = await service.stage(context, [upload()]);
    const restarted = createPhotoService(await createLocalPhotoStore(root));
    const grant = await restarted.issueAccess(context, photo!.objectKey, 1000);
    const stored = await restarted.read(context, grant);
    expect(stored.bytes).toEqual(expect.any(Uint8Array));
    expect(stored.contentType).toBe('image/png');
    expect((await stat(root)).mode & 0o077).toBe(0);
    expect((await stat(path.join(root, photo!.objectKey))).mode & 0o077).toBe(0);
    for (const file of ['image', 'metadata.json']) {
      expect((await stat(path.join(root, photo!.objectKey, file))).mode & 0o077).toBe(0);
    }
    expect(await readdir(root)).toEqual([photo!.objectKey]);
    const store = await createLocalPhotoStore(root);
    const existing = (await store.get(photo!.objectKey))!;
    await expect(
      store.put(photo!.objectKey, { ...existing, bytes: samplePng() }),
    ).rejects.toThrow();
    expect((await store.get(photo!.objectKey))!.bytes).toEqual(stored.bytes);
    await restarted.discard(context, [photo!.objectKey]);
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects path traversal and refuses symlinked object directories', async () => {
    const store = await createLocalPhotoStore(root);
    for (const key of ['../escape', '/tmp/outside', 'not-a-key']) {
      await expect(store.get(key)).rejects.toThrow();
      await expect(store.delete(key)).rejects.toThrow();
    }
    const key = randomUUID();
    await symlink(tmpdir(), path.join(root, key));
    await expect(store.get(key)).rejects.toThrow();
  });
});
