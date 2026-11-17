import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { PhotoError, PHOTO_LIMITS } from './photo-errors.js';
import { preparePhoto, readPhoto, type PreparedPhoto } from './photos.js';

export type StoredPhoto = PreparedPhoto & { ownerDigest: string };

/** Internal adapter: no public bucket, URL, filesystem path or credential in this interface. */
export interface PrivatePhotoStore {
  /** Create only; must never overwrite an existing object. */
  put(key: string, photo: StoredPhoto): Promise<void>;
  get(key: string): Promise<StoredPhoto | null>;
  /** Idempotent; used only for unaccepted upload attempts. */
  delete(key: string): Promise<void>;
}

export type GuestPhotoContext = { submissionId: string; guestSecret: string };
export type PhotoReference = Omit<PreparedPhoto, 'bytes'> & { objectKey: string };
export type PhotoAccess = { objectKey: string; expiresAt: number; token: string };
export const PHOTO_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function ownerDigest(context: GuestPhotoContext): string {
  if (!PHOTO_KEY.test(context.submissionId) || !/^[0-9a-f]{64}$/.test(context.guestSecret)) {
    throw new PhotoError('PHOTO_UNAVAILABLE', 404);
  }
  return createHash('sha256')
    .update(`report-photo-v1\0${context.submissionId}\0${context.guestSecret}`)
    .digest('hex');
}

function equalDigest(a: string, b: string): boolean {
  return (
    /^[0-9a-f]{64}$/.test(a) &&
    /^[0-9a-f]{64}$/.test(b) &&
    timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  );
}

/** Guest-only staging boundary. No staff role or recipient address grants photo access. */
export function createPhotoService(store: PrivatePhotoStore, now: () => number = Date.now) {
  const signingKey = randomBytes(32); // Local grants expire on service restart as well as by time.
  const sign = (owner: string, key: string, expiry: number) =>
    createHmac('sha256', signingKey).update(`${owner}\0${key}\0${expiry}`).digest('hex');

  async function lookup(context: GuestPhotoContext, key: string): Promise<StoredPhoto | null> {
    const owner = ownerDigest(context);
    if (!PHOTO_KEY.test(key)) throw new PhotoError('PHOTO_UNAVAILABLE', 404);
    let photo;
    try {
      photo = await store.get(key);
    } catch {
      throw new PhotoError('PHOTO_STORAGE_UNAVAILABLE', 503);
    }
    if (photo && !equalDigest(owner, photo.ownerDigest))
      throw new PhotoError('PHOTO_UNAVAILABLE', 404);
    return photo;
  }

  async function owned(context: GuestPhotoContext, key: string): Promise<StoredPhoto> {
    const photo = await lookup(context, key);
    if (!photo) throw new PhotoError('PHOTO_UNAVAILABLE', 404);
    return photo;
  }

  return {
    async stage(
      context: GuestPhotoContext,
      uploads: readonly AsyncIterable<Uint8Array>[],
    ): Promise<PhotoReference[]> {
      const owner = ownerDigest(context);
      if (uploads.length < 1 || uploads.length > PHOTO_LIMITS.count)
        throw new PhotoError('INVALID_PHOTO_COUNT', 400);
      const photos: PreparedPhoto[] = [];
      // Validate the whole batch before writing anything; process decoders serially.
      for (const stream of uploads) {
        let bytes;
        try {
          bytes = await readPhoto(stream);
        } catch (error) {
          if (error instanceof PhotoError) throw error;
          throw new PhotoError('INVALID_PHOTO', 400);
        }
        photos.push(await preparePhoto(bytes));
      }
      const attempted: string[] = [],
        result: PhotoReference[] = [];
      try {
        for (const photo of photos) {
          const objectKey = randomUUID();
          attempted.push(objectKey); // Include a put that writes then loses its acknowledgement.
          await store.put(objectKey, { ...photo, ownerDigest: owner });
          const { bytes, ...metadata } = photo;
          void bytes;
          result.push({ ...metadata, objectKey });
        }
        return result;
      } catch {
        const cleanup = await Promise.allSettled(attempted.map((key) => store.delete(key)));
        const remaining = attempted.filter((_key, index) => cleanup[index]!.status === 'rejected');
        if (remaining.length) throw new PhotoError('PHOTO_CLEANUP_REQUIRED', 503, remaining);
        throw new PhotoError('PHOTO_STORAGE_UNAVAILABLE', 503);
      }
    },

    async issueAccess(
      context: GuestPhotoContext,
      objectKey: string,
      lifetimeMs: number,
    ): Promise<PhotoAccess> {
      await owned(context, objectKey);
      // Development grant policy only; production presigned expiry remains adapter configuration.
      if (!Number.isInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > 300_000) {
        throw new PhotoError('PHOTO_UNAVAILABLE', 404);
      }
      const expiresAt = now() + lifetimeMs;
      return { objectKey, expiresAt, token: sign(ownerDigest(context), objectKey, expiresAt) };
    },

    async read(context: GuestPhotoContext, access: PhotoAccess): Promise<PreparedPhoto> {
      const owner = ownerDigest(context);
      if (
        !Number.isSafeInteger(access.expiresAt) ||
        access.expiresAt <= now() ||
        !equalDigest(access.token, sign(owner, access.objectKey, access.expiresAt))
      ) {
        throw new PhotoError('PHOTO_UNAVAILABLE', 404);
      }
      const { ownerDigest: digest, ...photo } = await owned(context, access.objectKey);
      void digest;
      return photo;
    },

    /** Caller must ensure this attempt cannot commit and has no accepted DB references (J6-30). */
    async discard(context: GuestPhotoContext, keys: readonly string[]): Promise<void> {
      // Authorize every existing object before deleting any; missing objects are safe on retry.
      ownerDigest(context);
      for (const key of keys) {
        await lookup(context, key);
      }
      const cleanup = await Promise.allSettled(keys.map((key) => store.delete(key)));
      const remaining = keys.filter((_key, index) => cleanup[index]!.status === 'rejected');
      if (remaining.length) throw new PhotoError('PHOTO_CLEANUP_REQUIRED', 503, remaining);
    },
  };
}
