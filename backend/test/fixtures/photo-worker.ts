// Dedicated local test entry point. Never registered in the application Worker.
import { randomUUID, randomBytes } from 'node:crypto';
import { createPhotoService, type StoredPhoto } from '../../src/modules/reports/photo-storage.js';
import { PhotoError } from '../../src/modules/reports/photo-errors.js';

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'GET') return new Response('photo-test');
    const objects = new Map<string, StoredPhoto>();
    const service = createPhotoService({
      async put(key, photo) {
        objects.set(key, photo);
      },
      async get(key) {
        return objects.get(key) ?? null;
      },
      async delete(key) {
        objects.delete(key);
      },
    });
    const context = { submissionId: randomUUID(), guestSecret: randomBytes(32).toString('hex') };
    try {
      const bytes = new Uint8Array(await request.arrayBuffer());
      const [photo] = await service.stage(context, [
        (async function* () {
          yield bytes;
        })(),
      ]);
      const access = await service.issueAccess(context, photo!.objectKey, 1000);
      const result = await service.read(context, access);
      let isolated = false;
      try {
        await service.read({ ...context, guestSecret: '0'.repeat(64) }, access);
      } catch (error) {
        isolated = error instanceof PhotoError && error.code === 'PHOTO_UNAVAILABLE';
      }
      await service.discard(context, [photo!.objectKey]);
      return Response.json({
        contentType: result.contentType,
        width: result.width,
        height: result.height,
        bytes: Buffer.from(result.bytes).toString('base64'),
        isolated,
        cleaned: objects.size === 0,
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof PhotoError ? error.code : 'PHOTO_TEST_FAILURE' },
        { status: error instanceof PhotoError ? error.status : 500 },
      );
    }
  },
};
