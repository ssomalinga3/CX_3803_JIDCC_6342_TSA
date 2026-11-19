import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { decode, encode } from 'fast-png';
import jpeg from 'jpeg-js';
import { preparePhoto, readPhoto } from '../src/modules/reports/photos.js';
import { PHOTO_LIMITS, PhotoError } from '../src/modules/reports/photo-errors.js';
import { orientationTiff } from '../src/modules/reports/photo-headers.js';
import {
  createPhotoService,
  type PrivatePhotoStore,
  type StoredPhoto,
} from '../src/modules/reports/photo-storage.js';
import {
  customPng,
  jpegWithExif,
  PIXELS,
  pngWithChunk,
  pngChunk,
  sampleJpeg,
  samplePng,
  tiffOrientation,
  upload,
} from './fixtures/photos.js';

describe('report photo validation and sanitization', () => {
  it('keeps PNG pixels byte-for-byte, preserves alpha and hashes original versus sanitized bytes', async () => {
    const input = pngWithChunk('tEXt', Buffer.from('GPS\0synthetic-private-location'));
    const photo = await preparePhoto(input);
    expect(photo).toMatchObject({ contentType: 'image/png', width: 2, height: 3 });
    expect(decode(photo.bytes, { checkCrc: true }).data).toEqual(PIXELS);
    expect(Buffer.from(photo.bytes).toString()).not.toContain('synthetic-private-location');
    expect(photo.sourceSha256).toBe(createHash('sha256').update(input).digest('hex'));
    expect(photo.sha256).not.toBe(photo.sourceSha256);
    expect(decode(photo.bytes).text).toEqual({});
  });

  it('rewrites JPEG without re-encoding: orientation-only EXIF, no comments/trailing payloads', async () => {
    const input = Buffer.concat([jpegWithExif(6), Buffer.from('private-trailing-payload')]);
    const photo = await preparePhoto(input);
    // Reported dimensions are as displayed; the stored scan keeps its encoded 2×3 size.
    expect(photo).toMatchObject({ contentType: 'image/jpeg', width: 3, height: 2 });
    const decoded = jpeg.decode(photo.bytes);
    expect([decoded.width, decoded.height]).toEqual([2, 3]);
    expect(decoded.comments).toBeUndefined();
    // SOI, then a 34-byte APP1 holding only the regenerated orientation field.
    expect(Buffer.from(photo.bytes).subarray(0, 38)).toEqual(
      Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 34]),
        Buffer.from('Exif\0\0'),
        orientationTiff(6),
      ]),
    );
    expect(Buffer.from(decoded.data)).toEqual(Buffer.from(jpeg.decode(sampleJpeg()).data));
    expect(Buffer.from(photo.bytes).toString()).not.toContain('private');
  });

  it('keeps only decoder-required JPEG segments and the Adobe transform marker', async () => {
    const segment = (marker: number, body: Buffer) => {
      const header = Buffer.from([0xff, marker, 0, 0]);
      header.writeUInt16BE(body.length + 2, 2);
      return Buffer.concat([header, body]);
    };
    const source = sampleJpeg();
    const adobe = segment(0xee, Buffer.from('Adobe\0\x64\0\0\0\0\x01', 'latin1'));
    const input = Buffer.concat([
      source.subarray(0, 2),
      segment(0xe2, Buffer.from('ICC_PROFILE\0private-device-model')),
      segment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0private-xmp-gps')),
      segment(0xed, Buffer.from('Photoshop 3.0\0private-iptc')),
      segment(0xfe, Buffer.from('private-comment')),
      adobe,
      source.subarray(2),
    ]);
    const photo = await preparePhoto(input);
    const output = Buffer.from(photo.bytes);
    expect(output.toString('latin1')).not.toMatch(/private|ICC_PROFILE|JFIF|xap/);
    expect(output.includes(adobe)).toBe(true);
    expect(photo.sha256).toBe(createHash('sha256').update(output).digest('hex'));
    // Idempotent: an already-clean file passes through unchanged.
    expect(Buffer.from((await preparePhoto(output)).bytes)).toEqual(output);
  });

  it('accepts a progressive JPEG and rejects arithmetic/lossless frames as unsupported', async () => {
    const progressive = sampleJpeg();
    const frame = progressive.indexOf(Buffer.from([0xff, 0xc0]));
    for (const [marker, code] of [
      [0xc2, undefined],
      [0xc3, 'UNSUPPORTED_PHOTO'],
      [0xc9, 'UNSUPPORTED_PHOTO'],
    ] as const) {
      const bytes = Buffer.from(progressive);
      bytes[frame + 1] = marker;
      if (code) await expect(preparePhoto(bytes)).rejects.toMatchObject({ code });
      // Structure is validated; entropy-coded data is copied, never decoded.
      else await expect(preparePhoto(bytes)).resolves.toMatchObject({ width: 2, height: 3 });
    }
  });

  it.each([
    [1, [0, 1, 2, 3, 4, 5]],
    [2, [1, 0, 3, 2, 5, 4]],
    [3, [5, 4, 3, 2, 1, 0]],
    [4, [4, 5, 2, 3, 0, 1]],
    [5, [0, 2, 4, 1, 3, 5]],
    [6, [4, 2, 0, 5, 3, 1]],
    [7, [5, 3, 1, 4, 2, 0]],
    [8, [1, 3, 5, 0, 2, 4]],
  ])(
    'preserves EXIF orientation %i as a regenerated orientation-only field',
    async (orientation, order) => {
      void order; // Pixel order is unchanged; viewers apply the preserved orientation.
      const photo = await preparePhoto(
        pngWithChunk('eXIf', Buffer.concat([tiffOrientation(orientation), Buffer.from('private')])),
      );
      const decoded = decode(photo.bytes);
      expect(decoded.data).toEqual(PIXELS);
      expect(Buffer.from(photo.bytes).toString('latin1')).not.toContain('private');
      expect([photo.width, photo.height]).toEqual(orientation >= 5 ? [3, 2] : [2, 3]);
      const exif = Buffer.from(photo.bytes).indexOf('eXIf');
      if (orientation === 1) expect(exif).toBe(-1);
      else {
        expect(exif).toBeLessThan(Buffer.from(photo.bytes).indexOf('IDAT'));
        expect(Buffer.from(photo.bytes).subarray(exif + 4, exif + 30)).toEqual(
          orientationTiff(orientation),
        );
      }
    },
  );

  it('keeps 16-bit grayscale and indexed PNGs, including palette transparency', async () => {
    const grayscale = encode({
      width: 1,
      height: 1,
      channels: 2,
      depth: 16,
      data: new Uint16Array([65535, 32768]),
    });
    expect(Array.from(decode((await preparePhoto(grayscale)).bytes).data)).toEqual([65535, 32768]);
    const palette = Buffer.from(
      encode({
        width: 2,
        height: 1,
        channels: 1,
        depth: 8,
        data: new Uint8Array([0, 1]),
        palette: [
          [255, 0, 0],
          [0, 255, 0],
        ],
      }),
    );
    // Build the indexed alpha table explicitly: fixture encoding must preserve palette indices.
    const start = palette.indexOf(Buffer.from('IDAT')) - 4;
    const transparent = Buffer.concat([
      palette.subarray(0, start),
      pngChunk('tRNS', Uint8Array.from([255, 0])),
      palette.subarray(start),
    ]);
    const indexed = decode((await preparePhoto(transparent)).bytes);
    expect(Array.from(indexed.data)).toEqual([0, 1]);
    expect(indexed.palette).toEqual([
      [255, 0, 0, 255],
      [0, 255, 0, 0],
    ]);
  });

  it.each([
    Buffer.from('<svg>private</svg>'),
    Buffer.from('GIF89a'),
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  ])('rejects non-images and signature-only spoofs with a fixed error', async (bytes) => {
    await expect(preparePhoto(bytes)).rejects.toBeInstanceOf(PhotoError);
    await expect(preparePhoto(bytes)).rejects.toMatchObject({ status: 415 });
  });

  it('rejects corrupt/truncated image content and animated PNG instead of silently losing frames', async () => {
    const corrupt = samplePng();
    corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
    for (const bytes of [
      corrupt,
      samplePng().subarray(0, 40),
      sampleJpeg().subarray(0, 100),
      pngWithChunk('acTL', Buffer.alloc(8)),
    ]) {
      await expect(preparePhoto(bytes)).rejects.toMatchObject({ status: 415 });
    }
  });

  it.each([
    [4097, 1],
    [1, 4097],
    [4000, 4000],
    [0, 1],
  ])('rejects dimensions %i×%i before decoding', async (width, height) => {
    const header = samplePng().subarray(16, 29);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    await expect(
      preparePhoto(customPng(header, deflateSync(Buffer.alloc(1)))),
    ).rejects.toMatchObject({ code: 'PHOTO_DIMENSIONS' });
    const jpg = sampleJpeg();
    const frame = jpg.indexOf(Buffer.from([0xff, 0xc0]));
    jpg.writeUInt16BE(height, frame + 5);
    jpg.writeUInt16BE(width, frame + 7);
    await expect(preparePhoto(jpg)).rejects.toMatchObject({ code: 'PHOTO_DIMENSIONS' });
  });

  it('rejects invalid PNG filter bytes, missing palettes and invalid depth/color pairs', async () => {
    const header = samplePng().subarray(16, 29);
    header.writeUInt32BE(1, 0);
    header.writeUInt32BE(1, 4);
    const pixel = (filter: number) => deflateSync(Buffer.from([filter, 1, 2, 3, 4]));
    await expect(preparePhoto(customPng(header, pixel(4)))).resolves.toMatchObject({ width: 1 });
    await expect(preparePhoto(customPng(header, pixel(5)))).rejects.toMatchObject({
      code: 'INVALID_PHOTO',
    });
    const indexed = Buffer.from(header);
    indexed[9] = 3;
    await expect(
      preparePhoto(customPng(indexed, deflateSync(Buffer.from([0, 0])))),
    ).rejects.toMatchObject({ code: 'INVALID_PHOTO' });
    const rgb16 = Buffer.from(header);
    rgb16[8] = 4;
    rgb16[9] = 2;
    await expect(preparePhoto(customPng(rgb16, pixel(0)))).rejects.toMatchObject({
      code: 'INVALID_PHOTO',
    });
  });

  it('accepts full-size 12 MP JPEG/PNG photos without decoding them', async () => {
    const width = 4000,
      height = 3000;
    const camera = Buffer.from(
      jpeg.encode({ width, height, data: Buffer.alloc(width * height * 4, 96) }, 80).data,
    );
    const rotated = Buffer.concat([
      camera.subarray(0, 2),
      jpegWithExif(6).subarray(2, jpegWithExif(6).indexOf(Buffer.from([0xff, 0xdb]))),
      camera.subarray(2),
    ]);
    await expect(preparePhoto(rotated)).resolves.toMatchObject({ width: 3000, height: 4000 });
    const png = encode({ width, height, channels: 4, data: new Uint8Array(width * height * 4) });
    await expect(preparePhoto(png)).resolves.toMatchObject({ width, height });
  }, 30_000);

  it('accepts the edge limit and rejects a PNG expansion bomb', async () => {
    const edge = encode({ width: 4096, height: 1, channels: 4, data: new Uint8Array(4096 * 4) });
    expect((await preparePhoto(edge)).width).toBe(4096);
    const bomb = customPng(samplePng().subarray(16, 29), deflateSync(Buffer.alloc(1_000_000)));
    await expect(preparePhoto(bomb)).rejects.toMatchObject({ code: 'INVALID_PHOTO' });
  });

  it('supports interlaced and packed grayscale pixels and ignores compressed private metadata', async () => {
    const interlaced = encode(
      { width: 2, height: 3, data: PIXELS, channels: 4 },
      { interlace: 'Adam7' },
    );
    expect(decode((await preparePhoto(interlaced)).bytes).data).toEqual(PIXELS);
    const header = samplePng().subarray(16, 29);
    header.writeUInt32BE(2, 0);
    header.writeUInt32BE(1, 4);
    header[8] = 1;
    header[9] = 0;
    const monochrome = customPng(header, deflateSync(Buffer.from([0, 0x80])));
    expect(Buffer.from((await preparePhoto(monochrome)).bytes)).toEqual(monochrome);
    const metadata = pngWithChunk(
      'zTXt',
      Buffer.concat([Buffer.from('Private\0\0'), deflateSync(Buffer.alloc(1_000_000, 65))]),
    );
    const sanitized = await preparePhoto(metadata);
    expect(decode(sanitized.bytes).text).toEqual({});
    expect(decode(sanitized.bytes).data).toEqual(PIXELS);
  });

  it('fails closed on mutated input: fixed errors only, stable sanitized output', async () => {
    // Seeded structural fuzzing. A hand-written parser must never throw raw errors or hang.
    let seed = 20261119;
    const random = (limit: number) => (seed = (seed * 1103515245 + 12345) >>> 0) % limit;
    const sources = [
      sampleJpeg(),
      jpegWithExif(6),
      samplePng(),
      pngWithChunk('eXIf', tiffOrientation(6)),
      Buffer.from(
        encode(
          { width: 9, height: 7, data: new Uint8Array(252), channels: 4 },
          { interlace: 'Adam7' },
        ),
      ),
    ];
    for (let i = 0; i < 3000; i++) {
      let bytes = Buffer.from(sources[i % sources.length]!);
      const position = random(bytes.length);
      switch (random(4)) {
        case 0:
          bytes = bytes.subarray(0, position);
          break;
        case 1:
          bytes[position] = bytes[position]! ^ (1 << random(8));
          break;
        case 2:
          bytes = Buffer.concat([
            bytes.subarray(0, position),
            Buffer.from([0xff, random(256), random(256)]),
            bytes.subarray(position),
          ]);
          break;
        default:
          bytes.writeUInt16BE(random(65536), Math.min(random(64), bytes.length - 2));
      }
      try {
        const photo = await preparePhoto(bytes);
        expect(Buffer.from((await preparePhoto(photo.bytes)).bytes)).toEqual(
          Buffer.from(photo.bytes),
        );
      } catch (error) {
        expect(error).toBeInstanceOf(PhotoError);
      }
    }
  }, 30_000);

  it('bounds streamed bytes and closes the iterator immediately on excess input', async () => {
    let closed = false,
      readTail = false;
    async function* tooLarge() {
      try {
        yield Buffer.alloc(PHOTO_LIMITS.bytes);
        yield Buffer.alloc(1);
        readTail = true;
      } finally {
        closed = true;
      }
    }
    await expect(readPhoto(tooLarge())).rejects.toMatchObject({ code: 'PHOTO_TOO_LARGE' });
    expect(closed).toBe(true);
    expect(readTail).toBe(false);
    await expect(preparePhoto(Buffer.alloc(PHOTO_LIMITS.bytes + 1))).rejects.toMatchObject({
      code: 'PHOTO_TOO_LARGE',
    });
  });
});

describe('private guest photo staging', () => {
  const context = { submissionId: randomUUID(), guestSecret: '1'.repeat(64) };
  const otherGuest = { ...context, guestSecret: '2'.repeat(64) };
  function storage() {
    const objects = new Map<string, StoredPhoto>();
    const writes: string[] = [];
    const store: PrivatePhotoStore = {
      async put(key, photo) {
        writes.push(key);
        if (objects.has(key)) throw new Error('collision');
        objects.set(key, photo);
      },
      async get(key) {
        return objects.get(key) ?? null;
      },
      async delete(key) {
        objects.delete(key);
      },
    };
    return { store, objects, writes };
  }

  it('stages ordered sanitized photos, reveals only safe references, and isolates ownership', async () => {
    const { store, objects } = storage();
    const service = createPhotoService(store);
    const references = await service.stage(context, [upload(), upload(sampleJpeg())]);
    expect(references.map((photo) => photo.contentType)).toEqual(['image/png', 'image/jpeg']);
    expect(JSON.stringify(references)).not.toContain(context.guestSecret);
    expect(references[0]).not.toHaveProperty('ownerDigest');
    expect(references[0]).not.toHaveProperty('bytes');
    expect(objects.size).toBe(2);
    const access = await service.issueAccess(context, references[0]!.objectKey, 1000);
    await expect(service.read(context, access)).resolves.toMatchObject({
      contentType: 'image/png',
    });
    for (const intruder of [otherGuest, { ...context, submissionId: randomUUID() }]) {
      await expect(service.issueAccess(intruder, access.objectKey, 1000)).rejects.toMatchObject({
        code: 'PHOTO_UNAVAILABLE',
      });
      await expect(service.read(intruder, access)).rejects.toMatchObject({
        code: 'PHOTO_UNAVAILABLE',
      });
      await expect(service.discard(intruder, [access.objectKey])).rejects.toMatchObject({
        code: 'PHOTO_UNAVAILABLE',
      });
    }
    expect(objects.size).toBe(2);
    await service.discard(
      context,
      references.map((photo) => photo.objectKey),
    );
    await service.discard(
      context,
      references.map((photo) => photo.objectKey),
    );
    expect(objects.size).toBe(0);
  });

  it('rejects forged, expired and restart-invalidated grants', async () => {
    const { store } = storage();
    let now = 1000;
    const service = createPhotoService(store, () => now);
    const [photo] = await service.stage(context, [upload()]);
    const access = await service.issueAccess(context, photo!.objectKey, 100);
    await expect(service.read(context, { ...access, expiresAt: 999999 })).rejects.toMatchObject({
      code: 'PHOTO_UNAVAILABLE',
    });
    await expect(service.read(context, { ...access, token: 'bad' })).rejects.toMatchObject({
      code: 'PHOTO_UNAVAILABLE',
    });
    const restarted = createPhotoService(store, () => now);
    await expect(restarted.read(context, access)).rejects.toMatchObject({
      code: 'PHOTO_UNAVAILABLE',
    });
    await expect(restarted.issueAccess(context, photo!.objectKey, 100)).resolves.toHaveProperty(
      'token',
    );
    now = access.expiresAt;
    await expect(service.read(context, access)).rejects.toMatchObject({
      code: 'PHOTO_UNAVAILABLE',
    });
  });

  it('validates count, credentials and the whole batch before writing anything', async () => {
    const { store, writes } = storage();
    const service = createPhotoService(store);
    for (const uploads of [[], [upload(), upload(), upload(), upload()]]) {
      await expect(service.stage(context, uploads)).rejects.toMatchObject({
        code: 'INVALID_PHOTO_COUNT',
      });
    }
    await expect(service.stage({ ...context, guestSecret: '' }, [upload()])).rejects.toMatchObject({
      code: 'PHOTO_UNAVAILABLE',
    });
    await expect(
      service.stage(context, [upload(), upload(Buffer.from('bad-photo'))]),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PHOTO' });
    async function* broken() {
      yield samplePng();
      throw new Error('private path / GPS');
    }
    await expect(service.stage(context, [broken()])).rejects.toMatchObject({
      message: 'INVALID_PHOTO',
    });
    expect(writes).toEqual([]);
  });

  it('cleans both acknowledged and ambiguously written objects after a storage failure', async () => {
    const { store, objects } = storage();
    let count = 0;
    store.put = async (key, photo) => {
      objects.set(key, photo);
      if (++count === 2) throw new Error('private-bucket');
    };
    await expect(
      createPhotoService(store).stage(context, [upload(), upload()]),
    ).rejects.toMatchObject({ message: 'PHOTO_STORAGE_UNAVAILABLE' });
    expect(objects.size).toBe(0);
  });

  it('preserves an existing object when a create-only write confirms a key conflict', async () => {
    const { store, objects } = storage();
    let count = 0;
    const existing = { ...(await preparePhoto(samplePng())), ownerDigest: '2'.repeat(64) };
    let conflictingKey = '';
    store.put = async (key, photo) => {
      if (++count === 2) {
        conflictingKey = key;
        objects.set(key, existing);
        throw new PhotoError('PHOTO_OBJECT_EXISTS', 409);
      }
      objects.set(key, photo);
    };
    await expect(
      createPhotoService(store).stage(context, [upload(), upload()]),
    ).rejects.toMatchObject({ code: 'PHOTO_STORAGE_UNAVAILABLE' });
    expect([...objects.keys()]).toEqual([conflictingKey]);
    expect(objects.get(conflictingKey)).toBe(existing);
  });

  it('surfaces cleanup failures for retry without returning raw dependency errors', async () => {
    const { store } = storage();
    store.put = async () => {
      throw new Error('private-bucket');
    };
    store.delete = async () => {
      throw new Error('private-bucket');
    };
    try {
      await createPhotoService(store).stage(context, [upload()]);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(PhotoError);
      expect(error).toMatchObject({ message: 'PHOTO_CLEANUP_REQUIRED', status: 503 });
      expect((error as PhotoError).cleanupKeys).toHaveLength(1);
    }
  });
});
