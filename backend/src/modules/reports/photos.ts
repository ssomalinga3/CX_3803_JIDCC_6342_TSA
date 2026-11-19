import { createHash } from 'node:crypto';
import { PHOTO_LIMITS, PhotoError } from './photo-errors.js';
import { PNG_SIGNATURE, sanitizeJpeg, sanitizePng } from './photo-headers.js';

export type PreparedPhoto = {
  bytes: Uint8Array;
  contentType: 'image/jpeg' | 'image/png';
  /** Displayed dimensions, after applying the preserved EXIF orientation. */
  width: number;
  height: number;
  /** Hash original upload bytes for request replay; never hash a sanitized copy instead. */
  sourceSha256: string;
  sha256: string;
};

/**
 * Accept only validated content. Filenames and browser MIME declarations are deliberately absent.
 *
 * Photos are sanitized by rewriting container segments/chunks, NOT by decoding and re-encoding
 * pixels. A pure-JS decode/re-encode needs far more memory than the 128 MB Cloudflare Worker
 * isolate allows: a 12 MP PNG measured 137–291 MB live, and jpeg-js's memory cap rejected
 * ordinary 8 MP camera JPEGs. Segment rewriting keeps peak memory near twice the upload size
 * while still removing every metadata segment (EXIF/GPS, XMP, ICC, text, comments, trailing
 * bytes). Orientation is kept as a freshly generated orientation-only EXIF field instead of
 * rotating pixels. Trade-off: pixel data is copied byte-for-byte rather than regenerated, so
 * structurally valid but corrupt image data is stored as received.
 */
export async function preparePhoto(input: Uint8Array): Promise<PreparedPhoto> {
  if (input.byteLength > PHOTO_LIMITS.bytes) throw new PhotoError('PHOTO_TOO_LARGE', 413);
  try {
    const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    let image, contentType: PreparedPhoto['contentType'];
    if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
      image = await sanitizePng(bytes);
      contentType = 'image/png';
    } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      image = sanitizeJpeg(bytes);
      contentType = 'image/jpeg';
    } else throw new PhotoError('UNSUPPORTED_PHOTO', 415);
    // Sanitized output only removes bytes apart from a 40-byte orientation field.
    if (image.bytes.byteLength > PHOTO_LIMITS.bytes) throw new PhotoError('PHOTO_TOO_LARGE', 413);
    const swapped = image.orientation >= 5;
    return {
      bytes: image.bytes,
      contentType,
      width: swapped ? image.height : image.width,
      height: swapped ? image.width : image.height,
      sourceSha256: createHash('sha256').update(bytes).digest('hex'),
      sha256: createHash('sha256').update(image.bytes).digest('hex'),
    };
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    throw new PhotoError('INVALID_PHOTO', 415);
  }
}

export async function readPhoto(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > PHOTO_LIMITS.bytes) throw new PhotoError('PHOTO_TOO_LARGE', 413);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}
