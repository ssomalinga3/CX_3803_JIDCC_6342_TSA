import { encode } from 'fast-png';
import jpeg from 'jpeg-js';
import { pngCrc, PNG_SIGNATURE } from '../../src/modules/reports/photo-headers.js';

export const PIXELS = Uint8Array.from([
  255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255, 0, 255, 255, 128, 255, 0, 255,
  255,
]);

export function samplePng() {
  return Buffer.from(encode({ width: 2, height: 3, data: PIXELS, channels: 4 }));
}

export function sampleJpeg() {
  return jpeg.encode({ width: 2, height: 3, data: PIXELS }, 95).data;
}

export function pngChunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(pngCrc(body));
  return Buffer.concat([size, body, crc]);
}

export function pngWithChunk(type: string, data: Uint8Array) {
  const png = samplePng();
  return Buffer.concat([png.subarray(0, 33), pngChunk(type, data), png.subarray(33)]);
}

export function tiffOrientation(value: number) {
  const data = Buffer.alloc(26);
  data.write('II');
  data.writeUInt16LE(42, 2);
  data.writeUInt32LE(8, 4);
  data.writeUInt16LE(1, 8);
  data.writeUInt16LE(0x112, 10);
  data.writeUInt16LE(3, 12);
  data.writeUInt32LE(1, 14);
  data.writeUInt16LE(value, 18);
  return data;
}

export function jpegWithExif(orientation: number) {
  const source = sampleJpeg();
  const metadata = Buffer.concat([
    Buffer.from('Exif\0\0'),
    tiffOrientation(orientation),
    Buffer.from('synthetic-private-GPS-and-camera-marker'),
  ]);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xffe1);
  header.writeUInt16BE(metadata.length + 2, 2);
  return Buffer.concat([source.subarray(0, 2), header, metadata, source.subarray(2)]);
}

export function customPng(header: Buffer, compressed: Uint8Array) {
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function* upload(bytes: Uint8Array = samplePng()) {
  yield bytes;
}
