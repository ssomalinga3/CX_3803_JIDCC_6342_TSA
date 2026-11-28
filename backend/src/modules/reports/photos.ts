import { createHash } from 'node:crypto';
import jpeg from 'jpeg-js';
import {
  decode as decodePng,
  encode as encodePng,
  convertIndexedToRgb,
  type DecodedPng,
} from 'fast-png';
import { PHOTO_LIMITS, PhotoError } from './photo-errors.js';
import { jpegHeader, pngHeader, PNG_SIGNATURE } from './photo-headers.js';

export type PreparedPhoto = {
  bytes: Uint8Array;
  contentType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  /** Hash original upload bytes for request replay; never hash a re-encoding instead. */
  sourceSha256: string;
  sha256: string;
};

function rgbaPng(image: DecodedPng): Uint8Array {
  const { width, height, depth, transparency } = image;
  let data = image.data,
    channels = image.channels,
    bits = depth;
  if (image.palette) {
    data = convertIndexedToRgb(image);
    channels = image.palette[0]!.length;
    bits = 8;
  }
  const rgba = new Uint8Array(width * height * 4),
    max = 2 ** bits - 1;
  if (
    data.length !== (bits < 8 ? Math.ceil((width * bits) / 8) * height : width * height * channels)
  ) {
    throw new PhotoError('INVALID_PHOTO', 415);
  }
  const sample = (i: number, channel: number) =>
    bits < 8
      ? (data[
          Math.floor(i / width) * Math.ceil((width * bits) / 8) +
            Math.floor(((i % width) * bits) / 8)
        ]! >>
          (8 - bits - (((i % width) * bits) % 8))) &
        max
      : data[i * channels + channel]!;
  for (let i = 0; i < width * height; i++) {
    const r = sample(i, 0),
      g = channels < 3 ? r : sample(i, 1),
      b = channels < 3 ? r : sample(i, 2);
    const transparent =
      transparency &&
      (channels === 1
        ? r === transparency[0]
        : channels === 3 &&
          r === transparency[0] &&
          g === transparency[1] &&
          b === transparency[2]);
    rgba[i * 4] = Math.round((r * 255) / max);
    rgba[i * 4 + 1] = Math.round((g * 255) / max);
    rgba[i * 4 + 2] = Math.round((b * 255) / max);
    rgba[i * 4 + 3] = transparent
      ? 0
      : channels === 2 || channels === 4
        ? Math.round((sample(i, channels - 1) * 255) / max)
        : 255;
  }
  return rgba;
}

/** Physically orient pixels so stripping EXIF does not rotate the visitor's photograph. */
function orient(data: Uint8Array, width: number, height: number, orientation: number) {
  if (orientation === 1) return { data, width, height };
  const swapped = orientation >= 5,
    w = swapped ? height : width,
    h = swapped ? width : height;
  const output = new Uint8Array(data.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let pixel: number;
      switch (orientation) {
        case 2:
          pixel = y * width + width - 1 - x;
          break;
        case 3:
          pixel = (height - 1 - y) * width + width - 1 - x;
          break;
        case 4:
          pixel = (height - 1 - y) * width + x;
          break;
        case 5:
          pixel = x * height + y;
          break;
        case 6:
          pixel = x * height + height - 1 - y;
          break;
        case 7:
          pixel = (width - 1 - x) * height + height - 1 - y;
          break;
        default:
          pixel = (width - 1 - x) * height + y;
      }
      for (let channel = 0; channel < 4; channel++) {
        output[pixel * 4 + channel] = data[(y * width + x) * 4 + channel]!;
      }
    }
  return { data: output, width: w, height: h };
}

/** Accept only decoded content. Filenames and browser MIME declarations are deliberately absent. */
export async function preparePhoto(input: Uint8Array): Promise<PreparedPhoto> {
  if (input.byteLength > PHOTO_LIMITS.bytes) throw new PhotoError('PHOTO_TOO_LARGE', 413);
  try {
    const bytes = Buffer.from(input);
    let pixels: { data: Uint8Array; width: number; height: number },
      contentType: PreparedPhoto['contentType'];
    if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
      const header = await pngHeader(bytes);
      const decoded = decodePng(header.bytes, { checkCrc: true });
      pixels = orient(rgbaPng(decoded), header.width, header.height, header.orientation);
      contentType = 'image/png';
    } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      const header = jpegHeader(bytes);
      const decoded = jpeg.decode(bytes, {
        useTArray: true,
        formatAsRGBA: true,
        tolerantDecoding: false,
        maxResolutionInMP: 12,
        maxMemoryUsageInMB: 96,
      });
      if (decoded.width !== header.width || decoded.height !== header.height)
        throw new PhotoError('INVALID_PHOTO', 415);
      pixels = orient(decoded.data, header.width, header.height, header.orientation);
      contentType = 'image/jpeg';
    } else throw new PhotoError('UNSUPPORTED_PHOTO', 415);
    // Copy pixels only. Never pass codec metadata/comments/EXIF into the encoder.
    const encoded =
      contentType === 'image/png'
        ? encodePng({
            width: pixels.width,
            height: pixels.height,
            data: pixels.data,
            channels: 4,
            depth: 8,
          })
        : jpeg.encode({ width: pixels.width, height: pixels.height, data: pixels.data }, 90).data;
    if (encoded.byteLength > PHOTO_LIMITS.bytes) throw new PhotoError('PHOTO_TOO_LARGE', 413);
    return {
      bytes: encoded,
      contentType,
      width: pixels.width,
      height: pixels.height,
      sourceSha256: createHash('sha256').update(bytes).digest('hex'),
      sha256: createHash('sha256').update(encoded).digest('hex'),
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
