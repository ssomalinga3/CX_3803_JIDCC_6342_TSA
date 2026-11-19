import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPhotoService } from '../src/modules/reports/photo-storage.js';
import { PhotoError, PHOTO_LIMITS } from '../src/modules/reports/photo-errors.js';
import { createLocalPhotoStore } from './local-photo-store.js';

const files = process.argv.slice(2);
async function* uploadFile(file: string) {
  // Open only when consumed, so a rejected first file cannot leave later files open.
  for await (const chunk of createReadStream(file)) yield chunk as Buffer;
}
if (files.length < 1 || files.length > PHOTO_LIMITS.count) {
  console.error('Usage: pnpm --dir backend photos:check <photo> [photo] [photo]');
  process.exitCode = 1;
} else {
  const root = await mkdtemp(path.join(tmpdir(), 'cascade-photos-'));
  try {
    const service = createPhotoService(await createLocalPhotoStore(root));
    const context = { submissionId: randomUUID(), guestSecret: randomBytes(32).toString('hex') };
    const photos = await service.stage(context, files.map(uploadFile));
    for (const [index, photo] of photos.entries()) {
      const access = await service.issueAccess(context, photo.objectKey, 60_000);
      const stored = await service.read(context, access);
      console.log(
        `Photo ${index + 1}: ${photo.contentType}, ${photo.width}×${photo.height}, ${stored.bytes.byteLength} sanitized bytes`,
      );
    }
    await service.discard(
      context,
      photos.map((photo) => photo.objectKey),
    );
    console.log(
      'PASS: local validation, private storage, authorized read and cleanup. No cloud upload.',
    );
  } catch (error) {
    console.error(error instanceof PhotoError ? error.code : 'PHOTO_CHECK_FAILED');
    process.exitCode = 1;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
