// Dedicated local test entry point. Never registered in the application Worker.
import { randomUUID, randomBytes } from 'node:crypto';
import { createPhotoService, type StoredPhoto } from '../../src/modules/reports/photo-storage.js';
import { PhotoError } from '../../src/modules/reports/photo-errors.js';
import { S3Client } from '@aws-sdk/client-s3';
import {
  createS3PhotoStore,
  type S3PhotoConfig,
} from '../../src/modules/reports/s3-photo-store.js';

// Run the real AWS SDK signing/serialization pipeline against an isolated fake transport.
// No network request or real AWS credential is used by this fixture.
function sdkStore() {
  const config: S3PhotoConfig = {
    region: 'us-east-2',
    bucket: 'worker-test-photos',
    accessKeyId: 'TESTACCESSKEY',
    secretAccessKey: 'test-secret-not-a-real-credential',
  };
  const objects = new Map<string, { bytes: Uint8Array; headers: Record<string, string> }>();
  const client = new S3Client({
    region: config.region,
    credentials: config,
    maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: {
      async handle(request: {
        method: string;
        path: string;
        headers: Record<string, string>;
        body?: unknown;
      }) {
        let response: Response;
        if (request.method === 'PUT') {
          if (!(request.body instanceof Uint8Array)) throw new Error('Unexpected SDK body');
          objects.set(request.path, { bytes: request.body, headers: request.headers });
          response = new Response('', { status: 200 });
        } else if (request.method === 'DELETE') {
          objects.delete(request.path);
          response = new Response(null, { status: 204 });
        } else {
          const object = objects.get(request.path);
          response = object
            ? new Response(Buffer.from(object.bytes), {
                headers: { ...object.headers, 'content-length': String(object.bytes.byteLength) },
              })
            : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
        }
        return {
          response: {
            statusCode: response.status,
            headers: Object.fromEntries(response.headers),
            body: response.body ?? new Uint8Array(),
          },
        };
      },
    },
  });
  return { store: createS3PhotoStore(config, client), objects };
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'GET') return new Response('photo-test');
    const objects = new Map<string, StoredPhoto>();
    const sdk = request.headers.get('x-photo-store') === 's3' ? sdkStore() : undefined;
    const service = createPhotoService(
      sdk?.store ?? {
        async put(key, photo) {
          objects.set(key, photo);
        },
        async get(key) {
          return objects.get(key) ?? null;
        },
        async delete(key) {
          objects.delete(key);
        },
      },
    );
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
      const signedExpiry = sdk
        ? new URL(await service.issueDownload(context, photo!.objectKey, 60)).searchParams.get(
            'X-Amz-Expires',
          )
        : null;
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
        cleaned: (sdk?.objects ?? objects).size === 0,
        signedExpiry,
      });
    } catch (error) {
      return Response.json(
        {
          error: error instanceof PhotoError ? error.code : 'PHOTO_TEST_FAILURE',
        },
        { status: error instanceof PhotoError ? error.status : 500 },
      );
    }
  },
};
