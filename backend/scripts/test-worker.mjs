import pg from 'pg';
import { localDatabaseUrl } from './local-config.mjs';
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
// Drain runtime logs without retaining URLs or connection diagnostics.
child.stdout.resume();
child.stderr.resume();
child.on('error', () => {});
let fixtureClient;
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
  if (!unavailable) {
    fixtureClient = new pg.Client({ connectionString: localDatabaseUrl() });
    await fixtureClient.connect();
    await fixtureClient.query(`INSERT INTO gis_layer (layer_id, name, description, layer_type, source)
      VALUES ('test-worker-private', 'Private', 'Test fixture', 'test', 'test')`);
    const catalog = await fetch(`${base}/api/v1/layers`);
    assert.equal(catalog.status, 200);
    assert.equal(catalog.headers.get('cache-control'), 'public, max-age=60');
    const layers = (await catalog.json()).layers;
    assert.ok(layers.some((layer) => layer.layerId === 'demo-trails' && layer.isDemo));
    assert.ok(!layers.some((layer) => layer.layerId === 'test-worker-private'));
    for (const [id, type, count] of [
      ['demo-trails', 'LineString', 2],
      ['demo-boundaries', 'Polygon', 1],
      ['demo-landmarks', 'Point', 2],
    ]) {
      const features = await fetch(`${base}/api/v1/layers/${id}/features`);
      assert.equal(features.status, 200);
      assert.ok(features.headers.get('content-type').includes('application/geo+json'));
      const collection = await features.json();
      assert.equal(collection.type, 'FeatureCollection');
      assert.equal(collection.features.length, count);
      assert.equal(collection.features[0].geometry.type, type);
    }
    const getFeatures = async (id, query = '') =>
      fetch(`${base}/api/v1/layers/${id}/features${query}`);
    const hidden = await getFeatures('test-worker-private');
    const unknown = await getFeatures('unknown');
    assert.equal(hidden.status, 404);
    assert.equal(unknown.status, 404);
    assert.deepEqual(await hidden.json(), await unknown.json());
    const filtered = await getFeatures('demo-landmarks', '?bbox=-84.481,33.719,-84.479,33.721');
    assert.deepEqual(
      (await filtered.json()).features.map((feature) => feature.id),
      ['demo-landmark-1'],
    );
    const empty = await getFeatures('demo-trails', '?bbox=0,0,1,1');
    assert.deepEqual(await empty.json(), { type: 'FeatureCollection', features: [] });
    for (const query of ['?bbox=bad', '?bbox=0,0,1,1&bbox=0,0,2,2', '?bbox=170,0,-170,1']) {
      const invalid = await getFeatures('demo-trails', query);
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).error.code, 'INVALID_BBOX');
    }
  } else {
    const failed = await fetch(`${base}/api/v1/layers`);
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), {
      error: { code: 'DATABASE_UNAVAILABLE', message: 'Layer data is unavailable', fields: {} },
    });
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
  // Wrangler can echo request URLs and connection settings: keep diagnostics redacted.
  console.error('Worker HTTP check failed; inspect the local runtime directly for diagnostics.');
  throw error;
} finally {
  try {
    if (fixtureClient) {
      try {
        await fixtureClient.query("DELETE FROM gis_layer WHERE layer_id = 'test-worker-private'");
      } finally {
        await fixtureClient.end();
      }
    }
  } finally {
    if (child.exitCode === null) {
      if (process.platform === 'win32') child.kill();
      else process.kill(-child.pid, 'SIGTERM');
    }
  }
}
