// Node development tooling only. Never import filesystem storage into the Worker/mobile bundle.
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PHOTO_KEY,
  type PrivatePhotoStore,
  type StoredPhoto,
} from '../src/modules/reports/photo-storage.js';
import { PHOTO_LIMITS, PhotoError } from '../src/modules/reports/photo-errors.js';

export async function createLocalPhotoStore(root: string): Promise<PrivatePhotoStore> {
  if (!path.isAbsolute(root)) throw new Error('Photo directory must be absolute');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('Photo directory must be a private directory');
  }
  function directory(key: string) {
    if (!PHOTO_KEY.test(key)) throw new Error('Invalid photo object key');
    return path.join(root, key);
  }
  async function privateRead(file: string) {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      return await readFile(handle);
    } finally {
      await handle.close();
    }
  }
  return {
    async put(key, photo) {
      const target = directory(key);
      const temporary = await mkdtemp(path.join(root, '.upload-'));
      try {
        const { bytes, ...metadata } = photo;
        await writeFile(path.join(temporary, 'image'), bytes, { mode: 0o600, flag: 'wx' });
        await writeFile(path.join(temporary, 'metadata.json'), JSON.stringify(metadata), {
          mode: 0o600,
          flag: 'wx',
        });
        // A complete object becomes visible atomically; existing nonempty objects cannot be replaced.
        try {
          await rename(temporary, target);
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')
          ) {
            throw new PhotoError('PHOTO_OBJECT_EXISTS', 409);
          }
          throw error;
        }
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    },
    async get(key) {
      const target = directory(key);
      try {
        const stat = await lstat(target);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid stored photo');
        const imageStat = await lstat(path.join(target, 'image'));
        const metadataStat = await lstat(path.join(target, 'metadata.json'));
        if (imageStat.size > PHOTO_LIMITS.bytes || metadataStat.size > 4096)
          throw new Error('Invalid stored photo');
        const metadata = JSON.parse(
          (await privateRead(path.join(target, 'metadata.json'))).toString(),
        ) as Omit<StoredPhoto, 'bytes'>;
        if (
          !/^[0-9a-f]{64}$/.test(metadata.ownerDigest) ||
          !['image/jpeg', 'image/png'].includes(metadata.contentType)
        )
          throw new Error('Invalid stored photo');
        return { ...metadata, bytes: await privateRead(path.join(target, 'image')) };
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
          return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(directory(key), { recursive: true, force: true });
    },
  };
}
