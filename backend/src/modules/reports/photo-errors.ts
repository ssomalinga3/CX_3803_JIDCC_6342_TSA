export type PhotoErrorCode =
  | 'INVALID_PHOTO_COUNT'
  | 'PHOTO_TOO_LARGE'
  | 'PHOTO_DIMENSIONS'
  | 'INVALID_PHOTO'
  | 'UNSUPPORTED_PHOTO'
  | 'PHOTO_UNAVAILABLE'
  | 'PHOTO_OBJECT_EXISTS'
  | 'PHOTO_STORAGE_UNAVAILABLE'
  | 'PHOTO_CLEANUP_REQUIRED';

/** Fixed messages only: decoder/storage errors can contain private input or paths. */
export class PhotoError extends Error {
  constructor(
    readonly code: PhotoErrorCode,
    readonly status: number,
    /** Internal retry work, never include in an HTTP response or application log. */
    readonly cleanupKeys: readonly string[] = [],
  ) {
    super(code);
    this.name = 'PhotoError';
  }
}

export const PHOTO_LIMITS = Object.freeze({
  count: 3,
  bytes: 5 * 1024 * 1024,
  requestBytes: 16 * 1024 * 1024,
  edge: 4096,
  pixels: 12_000_000,
});

export function checkDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > PHOTO_LIMITS.edge ||
    height > PHOTO_LIMITS.edge ||
    width * height > PHOTO_LIMITS.pixels
  )
    throw new PhotoError('PHOTO_DIMENSIONS', 413);
}
