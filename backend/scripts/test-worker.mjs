import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// A real Worker process and real PostGIS; no database mocks or Cloudflare login.
const unavailable = process.argv.includes('--database-unavailable');
const port = unavailable ? '18788' : '18787';
const child = spawn('pnpm', ['dev', '--port', port], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
  env: {
    ...process.env,
    WRANGLER_SEND_METRICS: 'false',
    ...(unavailable
      ? {
          CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
            'postgres://invalid:invalid@127.0.0.1:1/cascade_springs',
        }
      : {}),
  },
});
let output = '';
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (data) => {
    output = (output + data.toString()).slice(-16000);
  });
}
child.on('error', (error) => {
  output += error.message;
});
const base = `http://127.0.0.1:${port}`;

try {
  let started = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        started = true;
        break;
      }
    } catch {
      /* Wait for the local runtime to bind its port. */
    }
    await delay(500);
  }
  assert.ok(started, 'Worker did not start');
  const health = await fetch(`${base}/health`);
  assert.equal((await health.json()).status, 'ok');
  const ready = await fetch(`${base}/ready`, { signal: AbortSignal.timeout(10000) });
  assert.equal(ready.headers.get('cache-control'), 'no-store');
  if (unavailable) {
    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), {
      error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is not ready', fields: {} },
    });
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } else {
    assert.equal(ready.status, 200, 'Worker could not reach migrated PostGIS');
    assert.deepEqual(await ready.json(), { status: 'ok', database: 'ok' });
  }
  const missing = await fetch(`${base}/does-not-exist`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'NOT_FOUND');
  console.log(
    unavailable
      ? 'Worker database-failure response and liveness checks passed.'
      : 'Worker HTTP, Hyperdrive local binding, Drizzle, and PostGIS checks passed.',
  );
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (child.exitCode === null) {
    if (process.platform === 'win32') child.kill();
    else process.kill(-child.pid, 'SIGTERM');
  }
}
