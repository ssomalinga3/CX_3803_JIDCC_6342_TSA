import pg from 'pg';
import { localDatabaseUrl } from './local-config.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { once } from 'node:events';
import { stopProcessTree } from './process-tools.mjs';

// A real Worker process and real PostGIS; no database mocks or Cloudflare login.
const unavailable = process.argv.includes('--database-unavailable');
const port = unavailable ? '18788' : '18787';
const child = spawn(
  process.execPath,
  [fileURLToPath(new URL('./dev.mjs', import.meta.url)), '--port', port],
  {
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
  },
);
// Drain runtime logs without retaining URLs or connection diagnostics.
child.stdout.resume();
child.stderr.resume();
let launchFailed = false;
child.on('error', () => {
  launchFailed = true;
});
let fixtureClient;
const base = `http://127.0.0.1:${port}`;

try {
  let started = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (launchFailed || child.exitCode !== null) break;
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
    assert.ok(layers.some((layer) => layer.layerId === 'demo-boundaries' && layer.isDemo));
    assert.ok(!layers.some((layer) => layer.layerId === 'test-worker-private'));
    for (const [id, type, count] of [['demo-boundaries', 'Polygon', 1]]) {
      const features = await fetch(`${base}/api/v1/layers/${id}/features`);
      assert.equal(features.status, 200);
      assert.ok(features.headers.get('content-type').includes('application/geo+json'));
      const collection = await features.json();
      assert.equal(collection.type, 'FeatureCollection');
      assert.equal(collection.features.length, count);
      assert.equal(collection.features[0].geometry.type, type);
    }
    if (process.env.GIS_SOURCE_MAP === '1') {
      // Import path is exercised by CI/local setup; verify real source data through the Worker.
      assert.ok(layers.some((layer) => layer.layerId === 'cascade-map-trails' && !layer.isDemo));
      for (const [id, count] of [
        ['cascade-map-trails', 36],
        ['cascade-map-landmarks', 22],
        ['cascade-map-boundary', 1],
        ['cascade-map-water', 2],
        ['cascade-map-natural-areas', 2],
        ['cascade-map-roads', 3],
        ['cascade-map-buildings', 3],
        ['cascade-terrain-supplied', 29],
        ['cascade-terrain-usgs', 33],
        ['cascade-cell-signal', 677],
      ]) {
        const response = await fetch(`${base}/api/v1/layers/${id}/features`);
        assert.equal(response.status, 200);
        const collection = await response.json();
        assert.equal(collection.features.length, count);
        assert.ok(collection.features.every((feature) => feature.properties.isDemo === false));
        if (id.startsWith('cascade-terrain-')) {
          assert.equal(
            collection.features.filter((f) => f.properties.feature_kind === 'hillshade').length,
            1,
          );
          assert.ok(
            collection.features.some((f) => f.properties.feature_kind === 'elevation_band'),
          );
          assert.equal(
            new Set(collection.features.map((f) => f.properties.dataset_version)).size,
            1,
          );
        }
        if (id === 'cascade-map-trails') {
          assert.equal(
            new Set(
              collection.features
                .filter((feature) => feature.properties.trail_id)
                .map((feature) => feature.properties.trail_id),
            ).size,
            9,
          );
          assert.ok(
            collection.features.every(
              (feature) =>
                feature.properties.source_dataset === 'csnp-official-trails' &&
                feature.properties.source_properties.PublishTra === 'TRUE',
            ),
          );
        }
      }
    }
    const getFeatures = async (id, query = '') =>
      fetch(`${base}/api/v1/layers/${id}/features${query}`);
    const hidden = await getFeatures('test-worker-private');
    const unknown = await getFeatures('unknown');
    assert.equal(hidden.status, 404);
    assert.equal(unknown.status, 404);
    assert.deepEqual(await hidden.json(), await unknown.json());
    const empty = await getFeatures('demo-boundaries', '?bbox=0,0,1,1');
    assert.deepEqual(await empty.json(), { type: 'FeatureCollection', features: [] });
    for (const query of ['?bbox=bad', '?bbox=0,0,1,1&bbox=0,0,2,2', '?bbox=170,0,-170,1']) {
      const invalid = await getFeatures('demo-boundaries', query);
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
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      stopProcessTree(child, true);
      await once(child, 'close', { signal: AbortSignal.timeout(10000) });
    }
  }
}
