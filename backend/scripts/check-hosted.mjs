import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const root = new URL('../../', import.meta.url);
const envFile = new URL(existsSync(new URL('.env', root)) ? '.env' : '.env.local', root);
const env = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
try {
  const origin = new URL(process.env.API_ORIGIN || env.API_ORIGIN);
  assert.equal(origin.protocol, 'https:');
  assert.equal(origin.pathname, '/');
  assert.equal(origin.search + origin.hash + origin.username + origin.password, '');
  async function get(path, status = 200) {
    const response = await fetch(new URL(path, origin), {
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
    assert.equal(response.status, status);
    return { response, body: await response.json() };
  }
  assert.equal((await get('/health')).body.status, 'ok');
  const ready = await get('/ready');
  assert.equal(ready.response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(ready.body, { status: 'ok', database: 'ok' });
  const { response, body: catalog } = await get('/api/v1/layers');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=60');
  assert.ok(Array.isArray(catalog.layers) && catalog.layers.length > 0);
  assert.ok(catalog.layers.every((layer) => layer.isDemo === false));
  let features = 0;
  for (const layer of catalog.layers) {
    const path = `/api/v1/layers/${encodeURIComponent(layer.layerId)}/features`;
    const { response, body } = await get(path);
    assert.ok(response.headers.get('content-type').includes('application/geo+json'));
    assert.equal(body.type, 'FeatureCollection');
    assert.ok(Array.isArray(body.features) && body.features.length > 0);
    features += body.features.length;
    assert.equal((await get(`${path}?bbox=bad`, 400)).body.error.code, 'INVALID_BBOX');
  }
  assert.equal((await get('/api/v1/layers/unknown/features', 404)).body.error.code, 'NOT_FOUND');
  console.log(
    `Hosted API passed: health, PostGIS readiness, ${catalog.layers.length} public layers, ${features} features, cache headers, invalid input and unknown-layer access.`,
  );
} catch {
  console.error(
    'Hosted API check failed; verify deployment, database readiness and imported public GIS.',
  );
  process.exitCode = 1;
}
