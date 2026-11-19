import { createInflate } from 'node:zlib';
import { Readable } from 'node:stream';
import { PhotoError, checkDimensions } from './photo-errors.js';

export const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export type SanitizedImage = {
  /** Encoded (not displayed) dimensions; orientation 5–8 swaps them on display. */
  width: number;
  height: number;
  orientation: number;
  bytes: Buffer;
};

const invalid = (): never => {
  throw new PhotoError('INVALID_PHOTO', 415);
};
const unsupported = (): never => {
  throw new PhotoError('UNSUPPORTED_PHOTO', 415);
};

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

/** A fresh 26-byte TIFF block whose only field is Orientation. Nothing is copied from input. */
export function orientationTiff(orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0, 'ascii');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  return tiff; // Next-IFD offset (bytes 22–25) stays zero.
}

const SUPPORTED_FRAMES = new Set([0xc0, 0xc1, 0xc2]); // Huffman baseline/extended/progressive.
const UNSUPPORTED_FRAMES = new Set([
  0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcc, 0xcd, 0xce, 0xcf,
]);

/**
 * Rewrite a JPEG at the segment level without decoding pixels. Only decoder-required
 * segments survive: DQT, DHT, DRI, one frame header, scans and their entropy-coded data.
 * The 12-byte Adobe transform marker is kept because it changes color interpretation.
 * EXIF/XMP/ICC/JFIF/comments, every other APPn segment and bytes after EOI are dropped.
 */
export function sanitizeJpeg(bytes: Buffer): SanitizedImage {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid();
  const kept: Buffer[] = [];
  let offset = 2,
    orientation = 1,
    exifSeen = false,
    frame: { width: number; height: number } | undefined,
    scans = 0,
    quantization = false,
    ended = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) invalid();
    while (bytes[offset] === 0xff) offset++; // Fill bytes are legal before any marker.
    if (offset >= bytes.length) invalid();
    const marker = bytes[offset++]!;
    if (marker === 0xd9) {
      ended = true;
      break; // Anything after EOI is discarded.
    }
    // Standalone markers are not valid here: RSTn only occurs inside entropy-coded data.
    if (marker === 0x00 || marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7))
      invalid();
    if (offset + 2 > bytes.length) invalid();
    const length = bytes.readUInt16BE(offset),
      end = offset + length;
    if (length < 2 || end > bytes.length) invalid();
    const segment = bytes.subarray(offset - 2, end),
      body = bytes.subarray(offset + 2, end);
    offset = end;
    if (marker === 0xe1) {
      if (!exifSeen && body.toString('latin1', 0, 6) === 'Exif\0\0') {
        exifSeen = true;
        orientation = exifOrientation(body.subarray(6));
      }
    } else if (marker === 0xee) {
      if (length === 14 && body.toString('latin1', 0, 5) === 'Adobe') kept.push(segment);
    } else if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      /* Metadata, profiles, thumbnails and comments are never copied. */
    } else if (marker === 0xdb || marker === 0xc4 || marker === 0xdd) {
      if (marker === 0xdb) quantization = true;
      kept.push(segment);
    } else if (SUPPORTED_FRAMES.has(marker)) {
      if (frame || scans || length < 8) invalid();
      const components = body[5]!;
      if (body[0] !== 8 || ![1, 3, 4].includes(components) || length !== 8 + components * 3)
        invalid();
      for (let i = 0; i < components; i++) {
        const sampling = body[7 + i * 3]!;
        if (sampling >> 4 < 1 || sampling >> 4 > 4 || (sampling & 15) < 1 || (sampling & 15) > 4)
          invalid();
      }
      frame = { height: body.readUInt16BE(1), width: body.readUInt16BE(3) };
      checkDimensions(frame.width, frame.height);
      kept.push(segment);
    } else if (UNSUPPORTED_FRAMES.has(marker)) {
      unsupported();
    } else if (marker === 0xda) {
      const count = body[0] ?? 0;
      if (!frame || !quantization || count < 1 || count > 4 || length !== 6 + count * 2) invalid();
      kept.push(segment);
      scans++;
      // Entropy-coded data ends at the first 0xFF that is not stuffing (FF00) or RSTn.
      let cursor = offset;
      for (;;) {
        cursor = bytes.indexOf(0xff, cursor);
        if (cursor < 0 || cursor + 1 >= bytes.length) invalid(); // Truncated: no EOI.
        const next = bytes[cursor + 1]!;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) cursor += 2;
        else break;
      }
      kept.push(bytes.subarray(offset, cursor));
      offset = cursor;
    } else {
      invalid(); // DNL, hierarchical, JPG extensions and reserved markers.
    }
  }
  if (!ended || !frame || !scans) invalid();
  const exif =
    orientation === 1
      ? []
      : (() => {
          const payload = Buffer.concat([
            Buffer.from('Exif\0\0', 'latin1'),
            orientationTiff(orientation),
          ]);
          const header = Buffer.from([0xff, 0xe1, 0, 0]);
          header.writeUInt16BE(payload.length + 2, 2);
          return [header, payload];
        })();
  return {
    ...frame!,
    orientation,
    bytes: Buffer.concat([Buffer.from([0xff, 0xd8]), ...exif, ...kept, Buffer.from([0xff, 0xd9])]),
  };
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

function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8),
    crc = Buffer.alloc(4);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'ascii');
  crc.writeUInt32BE(pngCrc(Buffer.concat([header.subarray(4), data])));
  return Buffer.concat([header, data, crc]);
}

const PNG_DEPTHS = new Map([
  [0, [1, 2, 4, 8, 16]],
  [2, [8, 16]],
  [3, [1, 2, 4, 8]],
  [4, [8, 16]],
  [6, [8, 16]],
]);
const PNG_CHANNELS = new Map([
  [0, 1],
  [2, 3],
  [3, 1],
  [4, 2],
  [6, 4],
]);

/**
 * Validate every chunk, CRC, scanline filter byte and the exact inflated size, streaming
 * in 64 KiB pieces so pixels are never materialized. Keep only IHDR/PLTE/tRNS/IDAT/IEND
 * plus a freshly generated orientation-only eXIf chunk.
 */
export async function sanitizePng(bytes: Buffer): Promise<SanitizedImage> {
  if (
    bytes.length < 33 ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
    bytes.toString('ascii', 12, 16) !== 'IHDR' ||
    bytes.readUInt32BE(8) !== 13
  ) {
    invalid();
  }
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  checkDimensions(width, height);
  const depth = bytes[24]!,
    color = bytes[25]!,
    interlace = bytes[28]!;
  const channels = PNG_CHANNELS.get(color);
  if (
    !channels ||
    !PNG_DEPTHS.get(color)!.includes(depth) ||
    interlace > 1 ||
    bytes[26] !== 0 ||
    bytes[27] !== 0
  )
    invalid();
  const chunks: Buffer[] = [PNG_SIGNATURE],
    compressed: Buffer[] = [];
  let orientation = 1,
    exifSeen = false,
    palette = false,
    firstData = -1,
    ended = false,
    dataEnded = false;
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) invalid();
    const length = bytes.readUInt32BE(offset),
      end = offset + 12 + length;
    if (end > bytes.length) invalid();
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (pngCrc(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) invalid();
    if ((type === 'IHDR' && offset !== 8) || (type === 'IDAT' && dataEnded)) invalid();
    if (type === 'acTL') unsupported();
    if (type === 'PLTE') {
      if (palette || compressed.length || length === 0 || length % 3 || length > 768) invalid();
      if (color === 0 || color === 4) invalid();
      palette = true;
    }
    if (type === 'IDAT') {
      if (color === 3 && !palette) invalid();
      if (firstData < 0) firstData = chunks.length;
      compressed.push(bytes.subarray(offset + 8, end - 4));
    } else if (compressed.length) dataEnded = true;
    if (type === 'eXIf' && !exifSeen) {
      exifSeen = true;
      orientation = exifOrientation(bytes.subarray(offset + 8, end - 4));
    }
    if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(type))
      chunks.push(bytes.subarray(offset, end));
    else if ((bytes[offset + 4]! & 32) === 0) unsupported(); // Unknown critical chunk.
    offset = end;
    if (type === 'IEND') {
      if (length !== 0 || offset !== bytes.length) invalid();
      ended = true;
      break;
    }
  }
  if (!ended || !compressed.length) invalid();
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
  // [scanline length including its filter byte, scanline count] for each non-empty pass.
  const rows: [number, number][] = [];
  let expected = 0;
  for (const [x, y, dx, dy] of passes as [number, number, number, number][]) {
    const w = Math.max(0, Math.ceil((width - x) / dx)),
      h = Math.max(0, Math.ceil((height - y) / dy));
    if (!w || !h) continue;
    const line = Math.ceil((w * channels! * depth) / 8) + 1;
    rows.push([line, h]);
    expected += line * h;
  }
  // Count bounded output in small chunks; never allocate a decompression-bomb-sized buffer.
  const source = Readable.from(compressed);
  const inflater = source.pipe(createInflate({ chunkSize: 65536 }));
  let size = 0,
    row = 0,
    rowsLeft = rows[0]![1],
    remaining = 0;
  try {
    for await (const piece of inflater) {
      const chunk = piece as Buffer;
      size += chunk.length;
      if (size > expected) invalid();
      for (let position = 0; position < chunk.length;) {
        if (remaining === 0) {
          while (rowsLeft === 0) rowsLeft = rows[++row]![1];
          if (chunk[position]! > 4) invalid(); // PNG defines filter types 0–4 only.
          remaining = rows[row]![0];
          rowsLeft--;
        }
        const take = Math.min(remaining, chunk.length - position);
        position += take;
        remaining -= take;
      }
    }
  } finally {
    source.destroy();
    inflater.destroy();
  }
  if (size !== expected) invalid();
  if (orientation !== 1)
    chunks.splice(firstData, 0, pngChunk('eXIf', orientationTiff(orientation)));
  return { width, height, orientation, bytes: Buffer.concat(chunks) };
}
