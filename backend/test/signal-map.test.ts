import request from 'supertest';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createApp } from '../src/app.js';
import { withDatabase } from '../src/db/client.js';
import {
  importSignalMap,
  readSignalMap,
  signalLayer,
  signalContract,
  validateSignalMap,
} from '../src/db/signal-map.js';
import { importSourceMap, sourceMapLayers } from '../src/db/source-map.js';
import { importTerrainMap, readTerrainMap } from '../src/db/terrain-map.js';
import { importPdfMap, readPdfMap } from '../src/db/pdf-map.js';
import { importOfficialTrails, readOfficialTrails } from '../src/db/official-trails.js';
import { createLayersRepository } from '../src/modules/gis/layers.repo.js';
import { localDatabaseUrl } from '../scripts/local-config.mjs';
const snapshot = readSignalMap();
const legacy = JSON.parse(
  readFileSync(new URL('../../data/cascade-springs/features.geojson', import.meta.url), 'utf8'),
);

test('preserves the reviewed five classes and source pixels without claiming units or readings', () => {
  expect(snapshot.features).toHaveLength(677);
  expect(sourceMapLayers).toHaveLength(10);
  for (const c of signalContract.classes)
    expect(snapshot.features.filter((f) => f.properties.signal_class === c.label)).toHaveLength(
      c.recovered_count,
    );
});
test.each([
  'empty',
  'missing',
  'duplicate',
  'class',
  'reclassified',
  'source',
  'version',
  'pixel',
  'identity',
  'reading',
  'units',
  'carrier',
  'date',
  'nan',
  'range',
  'line',
])('rejects %s before opening a database', (kind) => {
  const value = structuredClone(snapshot);
  const f = value.features[0]!;
  if (kind === 'empty') value.features = [];
  if (kind === 'missing') value.features.pop();
  if (kind === 'duplicate') value.features[1] = f;
  if (kind === 'class') f.properties.signal_class = 'good';
  if (kind === 'reclassified') {
    f.properties.signal_class = '< -120';
    f.properties.name = 'Cell-signal sample · < -120';
  }
  if (kind === 'source') f.properties.source_sha256 = '0'.repeat(64);
  if (kind === 'version') f.properties.extraction_version = 2;
  if (kind === 'pixel') f.properties.source_pixel = [932, 0];
  if (kind === 'identity') f.id = 'csnp-signal-v1-0000-0000';
  if (kind === 'reading') f.properties.exact_value = -121;
  if (kind === 'units') f.properties.units = 'dBm';
  if (kind === 'carrier') f.properties.carrier = 'unknown';
  if (kind === 'date') f.properties.survey_date = '2026-11-12';
  if (kind === 'nan') f.geometry = { type: 'Point', coordinates: [NaN, 33.717] };
  if (kind === 'range') f.geometry = { type: 'Point', coordinates: [0, 0] };
  if (kind === 'line')
    f.geometry = {
      type: 'LineString',
      coordinates: [
        [-84.48, 33.717],
        [-84.48, 33.718],
      ],
    };
  expect(() => validateSignalMap(value)).toThrow();
});

const integration = process.env.GIS_INTEGRATION === '1' ? describe : describe.skip;
integration('signal observations through atomic imports, PostGIS and public reads', () => {
  const url = localDatabaseUrl();
  const app = createApp({ layers: createLayersRepository(() => url) });
  const get = (id = signalLayer.layerId, query = '') =>
    request(app).get(`/api/v1/layers/${id}/features${query}`);
  const expected = [...snapshot.features].sort((a, b) => a.id.localeCompare(b.id));
  const all = () => Promise.all(sourceMapLayers.map(async (l) => (await get(l.layerId)).body));
  beforeAll(async () => {
    await importSourceMap(url, legacy);
  });
  test('round-trips exact class/pixel/source metadata and GeoJSON coordinates', async () => {
    const result = await get();
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('public, max-age=60');
    expect(result.body.features).toEqual(expected);
  });
  test('repeated and concurrent legacy writers preserve one signal layer and remove stale samples', async () => {
    const before = await all();
    await withDatabase(url, (db) =>
      db.execute(
        sql`INSERT INTO gis_feature (feature_id,layer_id,geometry) VALUES ('stale-signal',${signalLayer.layerId},ST_GeomFromText('POINT(0 0)',4326))`,
      ),
    );
    await Promise.all([
      importSignalMap(url, snapshot),
      importSignalMap(url, snapshot),
      importSourceMap(url, legacy),
      importTerrainMap(url, readTerrainMap()),
      importPdfMap(url, readPdfMap()),
      importOfficialTrails(url, readOfficialTrails()),
    ]);
    expect(await all()).toEqual(before);
  });
  test('a late signal identity conflict rolls back both signal-only and full-source replacement', async () => {
    const id = snapshot.features.at(-1)!.id;
    await withDatabase(url, (db) =>
      db.execute(sql`UPDATE gis_feature SET layer_id='demo-boundaries' WHERE feature_id=${id}`),
    );
    const before = await all();
    try {
      await expect(importSignalMap(url, snapshot)).rejects.toThrow();
      expect(await all()).toEqual(before);
      await expect(importSourceMap(url, legacy)).rejects.toThrow();
      expect(await all()).toEqual(before);
    } finally {
      await withDatabase(url, (db) =>
        db.execute(sql`DELETE FROM gis_feature WHERE feature_id=${id}`),
      );
      await importSourceMap(url, legacy);
    }
  });
  test('bbox filters samples and private layers remain inaccessible', async () => {
    expect((await get(signalLayer.layerId, '?bbox=0,0,1,1')).body.features).toEqual([]);
    const partial = (await get(signalLayer.layerId, '?bbox=-84.48,33.717,-84.477,33.719')).body
      .features;
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(677);
    await withDatabase(url, (db) =>
      db.execute(sql`UPDATE gis_layer SET is_public=false WHERE layer_id=${signalLayer.layerId}`),
    );
    try {
      expect((await get()).status).toBe(404);
      expect(
        (await request(app).get('/api/v1/layers')).body.layers.map(
          (l: { layerId: string }) => l.layerId,
        ),
      ).not.toContain(signalLayer.layerId);
    } finally {
      await importSignalMap(url, snapshot);
    }
  });
});
