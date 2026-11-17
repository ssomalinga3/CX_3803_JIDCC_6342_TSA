import { createInflate } from 'node:zlib';
import { Readable } from 'node:stream';
import { PhotoError, checkDimensions } from './photo-errors.js';

export const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Read only orientation, never GPS/time or other EXIF fields. Invalid EXIF is discarded. */
function exifOrientation(tiff: Buffer): number {
  try {
    const little = tiff.toString('ascii', 0, 2) === 'II';
    if (!little && tiff.toString('ascii', 0, 2) !== 'MM') return 1;
    const short = (offset: number) =>
      little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
    const long = (offset: number) =>
      little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
    if (short(2) !== 42) return 1;
    const start = long(4);
    const count = short(start);
    if (start + 2 + count * 12 > tiff.length) return 1;
    for (let i = 0; i < count; i++) {
      const offset = start + 2 + i * 12;
      if (short(offset) === 0x112 && short(offset + 2) === 3 && long(offset + 4) === 1) {
        const value = short(offset + 8);
        return value >= 1 && value <= 8 ? value : 1;
      }
    }
  } catch {
    /* Malformed metadata cannot prevent stripping it. */
  }
  return 1;
}

export function jpegHeader(bytes: Buffer) {
  let offset = 2;
  let orientation = 1;
  let dimensions: { width: number; height: number } | undefined;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) break;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new PhotoError('INVALID_PHOTO', 415);
    if ([0xc0, 0xc1, 0xc2].includes(marker!)) {
      if (length < 8 || dimensions) throw new PhotoError('INVALID_PHOTO', 415);
      dimensions = {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
      checkDimensions(dimensions.width, dimensions.height);
    }
    if (marker === 0xe1 && bytes.toString('ascii', offset + 2, offset + 8) === 'Exif\0\0') {
      orientation = exifOrientation(bytes.subarray(offset + 8, offset + length));
    }
    offset += length;
  }
  if (!dimensions) throw new PhotoError('INVALID_PHOTO', 415);
  return { ...dimensions, orientation };
}

// PNG CRC covers chunk type and data, including discarded metadata.
export function pngCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Validate all chunks and bound decompression before passing pixels to the codec. */
export async function pngHeader(bytes: Buffer) {
  if (
    bytes.length < 33 ||
    bytes.toString('ascii', 12, 16) !== 'IHDR' ||
    bytes.readUInt32BE(8) !== 13
  ) {
    throw new PhotoError('INVALID_PHOTO', 415);
  }
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  checkDimensions(width, height);
  const depth = bytes[24]!,
    color = bytes[25]!,
    interlace = bytes[28]!;
  const channels = new Map([
    [0, 1],
    [2, 3],
    [3, 1],
    [4, 2],
    [6, 4],
  ]).get(color);
  if (
    !channels ||
    ![1, 2, 4, 8, 16].includes(depth) ||
    interlace > 1 ||
    bytes[26] !== 0 ||
    bytes[27] !== 0
  )
    throw new PhotoError('INVALID_PHOTO', 415);
  const chunks: Buffer[] = [PNG_SIGNATURE],
    compressed: Buffer[] = [];
  let orientation = 1,
    ended = false,
    dataEnded = false;
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) throw new PhotoError('INVALID_PHOTO', 415);
    const length = bytes.readUInt32BE(offset),
      end = offset + 12 + length;
    if (end > bytes.length) throw new PhotoError('INVALID_PHOTO', 415);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (pngCrc(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) {
      throw new PhotoError('INVALID_PHOTO', 415);
    }
    if ((type === 'IHDR' && offset !== 8) || (type === 'IDAT' && dataEnded)) {
      throw new PhotoError('INVALID_PHOTO', 415);
    }
    if (type === 'acTL') throw new PhotoError('UNSUPPORTED_PHOTO', 415);
    if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4));
    else if (compressed.length) dataEnded = true;
    if (type === 'eXIf') orientation = exifOrientation(bytes.subarray(offset + 8, end - 4));
    if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(type))
      chunks.push(bytes.subarray(offset, end));
    else if ((bytes[offset + 4]! & 32) === 0) throw new PhotoError('UNSUPPORTED_PHOTO', 415);
    offset = end;
    if (type === 'IEND') {
      if (length !== 0 || offset !== bytes.length) throw new PhotoError('INVALID_PHOTO', 415);
      ended = true;
      break;
    }
  }
  if (!ended || !compressed.length) throw new PhotoError('INVALID_PHOTO', 415);
  const passes = interlace
    ? [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
    : [[0, 0, 1, 1]];
  let expected = 0;
  for (const [x, y, dx, dy] of passes as [number, number, number, number][]) {
    const w = Math.max(0, Math.ceil((width - x) / dx)),
      h = Math.max(0, Math.ceil((height - y) / dy));
    if (w && h) expected += (Math.ceil((w * channels * depth) / 8) + 1) * h;
  }
  // Count bounded output in small chunks; never allocate a decompression-bomb-sized buffer.
  const source = Readable.from(compressed);
  const inflater = source.pipe(createInflate({ chunkSize: 65536 }));
  let size = 0;
  try {
    for await (const chunk of inflater) {
      size += (chunk as Buffer).length;
      if (size > expected) throw new PhotoError('INVALID_PHOTO', 415);
    }
  } finally {
    source.destroy();
    inflater.destroy();
  }
  if (size !== expected) throw new PhotoError('INVALID_PHOTO', 415);
  return { width, height, orientation, bytes: Buffer.concat(chunks) };
}
