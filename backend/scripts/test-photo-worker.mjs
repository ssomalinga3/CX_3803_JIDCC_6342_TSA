import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import { encode, decode } from 'fast-png';
import jpeg from 'jpeg-js';
import { nodeToolCommand, stopProcessTree } from './process-tools.mjs';

// Only synthetic images. Dedicated ephemeral Worker config: no DB, bucket or cloud login.
const temporary = await mkdtemp(path.join(tmpdir(), 'cascade-photo-worker-'));
const config = path.join(temporary, 'wrangler.json');
await writeFile(
  config,
  JSON.stringify({
    name: 'cascade-photo-test',
    main: fileURLToPath(new URL('../test/fixtures/photo-worker.ts', import.meta.url)),
    compatibility_date: '2026-10-23',
    compatibility_flags: ['nodejs_compat'],
  }),
);
const base = 'http://127.0.0.1:18789';
const command = nodeToolCommand('wrangler', [
  'dev',
  '--local',
  '--config',
  config,
  '--ip',
  '127.0.0.1',
  '--port',
  '18789',
  '--persist-to',
  path.join(temporary, 'state'),
]);
const child = spawn(command.file, command.args, {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
  env: {
    ...process.env,
    WRANGLER_SEND_METRICS: 'false',
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
  },
});
child.stdout.resume();
child.stderr.resume();
let failed = false;
child.on('error', () => {
  failed = true;
});
try {
  let started = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (failed || child.exitCode !== null) break;
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(500) });
      if ((await response.text()) === 'photo-test') {
        started = true;
        break;
      }
    } catch {
      /* Wait for local runtime. */
    }
    await delay(300);
  }
  assert.ok(started, 'Photo test Worker did not start; keep port 18789 free');
  const pixels = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128]);
  const png = encode({
    width: 2,
    height: 1,
    data: pixels,
    channels: 4,
    text: { GPS: 'synthetic-private-marker' },
  });
  const jpg = jpeg.encode(
    { width: 2, height: 1, data: pixels, comments: ['synthetic-private-marker'] },
    90,
  ).data;
  for (const adapter of ['memory', 's3'])
    for (const [body, type] of [
      [png, 'image/png'],
      [jpg, 'image/jpeg'],
    ]) {
      const response = await fetch(base, {
        method: 'POST',
        headers: { 'x-photo-store': adapter },
        body,
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      const result = await response.json();
      assert.equal(result.contentType, type);
      assert.equal(result.width, 2);
      assert.equal(result.height, 1);
      assert.equal(result.isolated, true);
      assert.equal(result.cleaned, true);
      assert.equal(result.signedExpiry, adapter === 's3' ? '60' : null);
      const bytes = Buffer.from(result.bytes, 'base64');
      assert.equal(bytes.includes(Buffer.from('synthetic-private-marker')), false);
      if (type === 'image/png')
        assert.deepEqual(Array.from(decode(bytes).data), Array.from(pixels));
      else assert.equal(jpeg.decode(bytes).width, 2);
    }
  // Full-size inputs at the approved 12 MP limit, sanitized in the actual Worker runtime.
  // EXIF orientation 6 (big-endian TIFF) on a 4000×3000 JPEG must display as 3000×4000.
  const large = { width: 4000, height: 3000 };
  const exif = Buffer.from(
    '457869660000' + '4d4d002a00000008000101120003000000010006' + '0000' + '00000000',
    'hex',
  );
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, exif.length + 2]), exif]);
  const camera = Buffer.from(
    jpeg.encode({ ...large, data: Buffer.alloc(large.width * large.height * 4, 96) }, 80).data,
  );
  const fullSize = [
    [Buffer.concat([camera.subarray(0, 2), app1, camera.subarray(2)]), 'image/jpeg', 3000, 4000],
    [
      encode({ ...large, channels: 4, data: new Uint8Array(large.width * large.height * 4) }),
      'image/png',
      4000,
      3000,
    ],
  ];
  for (const [body, type, width, height] of fullSize) {
    const response = await fetch(base, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 200, `${type} at 12 MP was not accepted`);
    const result = await response.json();
    assert.deepEqual([result.contentType, result.width, result.height], [type, width, height]);
  }
  const invalid = await fetch(base, { method: 'POST', body: '<svg>spoof</svg>' });
  assert.equal(invalid.status, 415);
  assert.deepEqual(await invalid.json(), { error: 'UNSUPPORTED_PHOTO' });
  console.log(
    'Worker JPEG/PNG validation, sanitization, 12 MP, ownership, cleanup and AWS SDK signing checks passed.',
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    stopProcessTree(child, true);
    await Promise.race([exited, delay(5000)]);
  }
  await rm(temporary, { recursive: true, force: true });
}
