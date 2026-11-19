import { createHash } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import { checkDimensions, PhotoError, PHOTO_LIMITS } from './photo-errors.js';
import { PHOTO_KEY, type PrivatePhotoStore, type StoredPhoto } from './photo-storage.js';
import { readPhoto } from './photos.js';

export type S3PhotoConfig = {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

/** Server-only explicit configuration; never fall back to shared machine credentials. */
export function s3PhotoConfig(env: Record<string, string | undefined>): S3PhotoConfig {
  const {
    AWS_REGION: region,
    S3_BUCKET: bucket,
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
    AWS_SESSION_TOKEN: sessionToken,
  } = env;
  if (
    !region ||
    !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region) ||
    !bucket ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    !accessKeyId ||
    !secretAccessKey
  )
    throw new Error('S3_PHOTO_CONFIG_REQUIRED');
  return {
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
  };
}

export function createS3PhotoClient(config: S3PhotoConfig): S3Client {
  return new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
    },
    requestHandler: new FetchHttpHandler({ requestTimeout: 15_000 }),
    // Upload attempts and cleanup are coordinated by the reporting service, not hidden SDK retries.
    maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
}

export interface S3PhotoStore extends PrivatePhotoStore {
  /** Internal only: service must verify ownership before calling. Never persist this URL. */
  presignGet(key: string, lifetimeSeconds: number): Promise<string>;
}

export function createS3PhotoStore(
  config: S3PhotoConfig,
  client = createS3PhotoClient(config),
): S3PhotoStore {
  function key(value: string) {
    if (!PHOTO_KEY.test(value)) throw new PhotoError('PHOTO_UNAVAILABLE', 404);
    return `report-photos/${value}`;
  }
  return {
    async put(objectKey, photo) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key(objectKey),
            Body: photo.bytes,
            ContentType: photo.contentType,
            ContentLength: photo.bytes.byteLength,
            CacheControl: 'private, no-store',
            ServerSideEncryption: 'AES256',
            IfNoneMatch: '*',
            // No ACL: retain bucket-owner-enforced ownership and block-public-access policy.
            Metadata: {
              'owner-digest': photo.ownerDigest,
              width: String(photo.width),
              height: String(photo.height),
              'source-sha256': photo.sourceSha256,
              sha256: photo.sha256,
            },
          }),
        );
      } catch (error) {
        if (error instanceof Error && error.name === 'PreconditionFailed') {
          throw new PhotoError('PHOTO_OBJECT_EXISTS', 409);
        }
        throw error;
      }
    },
    async get(objectKey) {
      let result;
      try {
        result = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: key(objectKey) }),
        );
      } catch (error) {
        if (error instanceof Error && error.name === 'NoSuchKey') return null;
        throw error;
      }
      const metadata = result.Metadata ?? {};
      const width = Number(metadata.width),
        height = Number(metadata.height);
      const validDigest = (value: string | undefined): value is string =>
        !!value && /^[0-9a-f]{64}$/.test(value);
      if (
        !result.Body ||
        !validDigest(metadata['owner-digest']) ||
        !validDigest(metadata['source-sha256']) ||
        !validDigest(metadata.sha256) ||
        !['image/jpeg', 'image/png'].includes(result.ContentType ?? '') ||
        result.ContentLength === undefined ||
        result.ContentLength < 1 ||
        result.ContentLength > PHOTO_LIMITS.bytes
      ) {
        if (result.Body) await result.Body.transformToWebStream().cancel();
        throw new PhotoError('PHOTO_STORAGE_UNAVAILABLE', 503);
      }
      try {
        checkDimensions(width, height);
      } catch {
        await result.Body.transformToWebStream().cancel();
        throw new PhotoError('PHOTO_STORAGE_UNAVAILABLE', 503);
      }
      const body = result.Body;
      const bytes = await readPhoto(
        (async function* () {
          const reader = body.transformToWebStream().getReader();
          try {
            for (;;) {
              const item = await reader.read();
              if (item.done) break;
              yield item.value;
            }
          } finally {
            await reader.cancel();
            reader.releaseLock();
          }
        })(),
      );
      if (
        bytes.byteLength !== result.ContentLength ||
        createHash('sha256').update(bytes).digest('hex') !== metadata.sha256
      ) {
        throw new PhotoError('PHOTO_STORAGE_UNAVAILABLE', 503);
      }
      return {
        bytes,
        contentType: result.ContentType as StoredPhoto['contentType'],
        width,
        height,
        ownerDigest: metadata['owner-digest'],
        sourceSha256: metadata['source-sha256'],
        sha256: metadata.sha256,
      };
    },
    async delete(objectKey) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key(objectKey) }));
    },
    async presignGet(objectKey, lifetimeSeconds) {
      if (!Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 1 || lifetimeSeconds > 300) {
        throw new PhotoError('PHOTO_UNAVAILABLE', 404);
      }
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key(objectKey),
          ResponseCacheControl: 'private, no-store',
          ResponseContentDisposition: 'inline',
        }),
        { expiresIn: lifetimeSeconds },
      );
    },
  };
}
