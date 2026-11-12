import request from 'supertest';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createApp } from '../src/app.js';
import { withDatabase } from '../src/db/client.js';
import {
  importTerrainMap,
  readTerrainMap,
  terrainLayers,
  terrainReplacements,
  validateTerrainMap,
} from '../src/db/terrain-map.js';
import { importSourceMap } from '../src/db/source-map.js';
import { importPdfMap, readPdfMap } from '../src/db/pdf-map.js';
import { importOfficialTrails, readOfficialTrails } from '../src/db/official-trails.js';
import { createLayersRepository } from '../src/modules/gis/layers.repo.js';
import { localDatabaseUrl } from '../scripts/local-config.mjs';
const snapshot = readTerrainMap();
const legacy = JSON.parse(
  readFileSync(new URL('../../data/cascade-springs/features.geojson', import.meta.url), 'utf8'),
);

test('assigns elevation and bundled hillshade to exactly two source options with distinct provenance', () => {
  const replacements = terrainReplacements(snapshot);
  expect(replacements.map((r) => r.collection.features.length)).toEqual([29, 33]);
  expect(replacements.map((r) => r.layer.layerId)).toEqual([
    'cascade-terrain-supplied',
    'cascade-terrain-usgs',
  ]);
  expect(new Set(snapshot.features.map((f) => f.properties.source_sha256)).size).toBe(2);
});
test.each([
  'empty',
  'duplicate',
  'missing-source',
  'version',
  'image-hash',
  'image-position',
  'source-hash',
  'units',
  'nan',
  'range',
  'open-ring',
  'invented-ascent',
  'remote-url',
  'wrong-kind',
])('rejects %s before a database connection', (kind) => {
  const value = structuredClone(snapshot);
  const image = value.features[0]!;
  const band = value.features.find((f) => f.properties.feature_kind === 'elevation_band')!;
  if (kind === 'empty') value.features = [];
  if (kind === 'duplicate') value.features.push(image);
  if (kind === 'missing-source')
    value.features = value.features.filter(
      (f) => f.properties.source_dataset !== 'csnp-terrain-usgs',
    );
  if (kind === 'version') image.properties.dataset_version = 'old';
  if (kind === 'image-hash') image.properties.raster_sha256 = 'old';
  if (kind === 'source-hash') band.properties.source_sha256 = '0'.repeat(64);
  if (kind === 'units') band.properties.elevation_max_ft_us = 400;
  if (kind === 'nan') band.properties.elevation_min_ft_us = NaN;
  if (kind === 'invented-ascent') band.properties.ELEV_GAIN = 0;
  if (kind === 'remote-url') image.properties.url = 'https://example.com/terrain.png';
  if (kind === 'wrong-kind') band.properties.feature_kind = 'boundary';
  if (image.geometry.type === 'Polygon') {
    if (kind === 'image-position') image.geometry.coordinates[0]![1]![0] += 0.0001;
    if (kind === 'range') image.geometry.coordinates[0]![0]![0] = 0;
    if (kind === 'open-ring') image.geometry.coordinates[0]!.pop();
  }
  expect(() => validateTerrainMap(value)).toThrow();
});

const integration = process.env.GIS_INTEGRATION === '1' ? describe : describe.skip;
integration('two terrain sources through PostGIS and the public API', () => {
  const url = localDatabaseUrl();
  const app = createApp({ layers: createLayersRepository(() => url) });
  const get = (id: string, query = '') => request(app).get(`/api/v1/layers/${id}/features${query}`);
  const expected = (key: number) =>
    [...terrainReplacements(snapshot)[key]!.collection.features].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
  beforeAll(async () => {
    await importSourceMap(url, legacy);
  });
  test('round-trips bands, units, placement, version and independent catalog membership', async () => {
    for (const [i, layer] of terrainLayers.entries()) {
      const result = await get(layer.layerId);
      expect(result.status).toBe(200);
      expect(result.headers['cache-control']).toBe('public, max-age=60');
      expect(result.body.features).toEqual(expected(i));
    }
  });
  test('concurrent replay removes stale terrain without altering trails or PDF context', async () => {
    const before = (await get('cascade-map-trails')).body;
    await withDatabase(url, (db) =>
      db.execute(
        sql`INSERT INTO gis_feature (feature_id,layer_id,geometry) VALUES ('old-terrain','cascade-terrain-supplied',ST_GeomFromText('POINT(0 0)',4326))`,
      ),
    );
    await Promise.all([
      importTerrainMap(url, snapshot),
      importSourceMap(url, legacy),
      importPdfMap(url, readPdfMap()),
      importOfficialTrails(url, readOfficialTrails()),
    ]);
    expect((await get('cascade-map-trails')).body).toEqual(before);
    for (const [i, layer] of terrainLayers.entries())
      expect((await get(layer.layerId)).body.features).toEqual(expected(i));
  });
  test('late topology failure rolls back both terrain options', async () => {
    const before = await Promise.all(terrainLayers.map(async (l) => (await get(l.layerId)).body));
    const invalid = structuredClone(snapshot);
    const last = invalid.features.at(-1)!;
    last.geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [-84.48, 33.716],
          [-84.479, 33.717],
          [-84.479, 33.716],
          [-84.48, 33.717],
          [-84.48, 33.716],
        ],
      ],
    };
    await expect(importTerrainMap(url, invalid)).rejects.toThrow();
    expect(await Promise.all(terrainLayers.map(async (l) => (await get(l.layerId)).body))).toEqual(
      before,
    );
  });
  test('terrain identity conflicts roll back the combined source replacement', async () => {
    const id = snapshot.features.at(-1)!.id;
    await withDatabase(url, (db) =>
      db.execute(sql`UPDATE gis_feature SET layer_id='demo-boundaries' WHERE feature_id=${id}`),
    );
    const before = await Promise.all(
      ['cascade-map-trails', 'cascade-map-boundary', ...terrainLayers.map((l) => l.layerId)].map(
        async (id) => (await get(id)).body,
      ),
    );
    try {
      await expect(importSourceMap(url, legacy)).rejects.toThrow();
      expect(
        await Promise.all(
          [
            'cascade-map-trails',
            'cascade-map-boundary',
            ...terrainLayers.map((l) => l.layerId),
          ].map(async (id) => (await get(id)).body),
        ),
      ).toEqual(before);
    } finally {
      await withDatabase(url, (db) =>
        db.execute(sql`DELETE FROM gis_feature WHERE feature_id=${id}`),
      );
      await importSourceMap(url, legacy);
    }
  });
  test('bbox and public/private restrictions apply to each source option', async () => {
    for (const layer of terrainLayers) {
      expect((await get(layer.layerId, '?bbox=0,0,1,1')).body.features).toEqual([]);
      expect(
        (await get(layer.layerId, '?bbox=-84.485,33.714,-84.474,33.721')).body.features.length,
      ).toBeGreaterThan(0);
      await withDatabase(url, (db) =>
        db.execute(sql`UPDATE gis_layer SET is_public=false WHERE layer_id=${layer.layerId}`),
      );
      try {
        expect((await get(layer.layerId)).status).toBe(404);
        expect(
          (await request(app).get('/api/v1/layers')).body.layers.map(
            (l: { layerId: string }) => l.layerId,
          ),
        ).not.toContain(layer.layerId);
      } finally {
        await importTerrainMap(url, snapshot);
      }
    }
  });
});
