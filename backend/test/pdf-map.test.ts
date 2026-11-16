import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { withDatabase } from '../src/db/client.js';
import {
  importPdfMap,
  pdfMapLayers,
  pdfMapReplacements,
  readPdfMap,
  validatePdfMap,
} from '../src/db/pdf-map.js';
import { importBoundaryMap } from '../src/db/boundary-map.js';
import { importSourceMap } from '../src/db/source-map.js';
import { importOfficialTrails, readOfficialTrails } from '../src/db/official-trails.js';
import { createLayersRepository } from '../src/modules/gis/layers.repo.js';
import { localDatabaseUrl } from '../scripts/local-config.mjs';
const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const snapshot = readPdfMap();
const legacy = read('../../data/cascade-springs/features.geojson');
const boundary = read('../../data/cascade-springs/approximate-boundary.geojson');

test('assigns every reviewed feature once, including same-geometry context layers and reconciled landmarks', () => {
  const replacements = pdfMapReplacements(validatePdfMap(snapshot));
  expect(replacements.map((r) => r.collection.features.length)).toEqual([1, 2, 2, 3, 3, 22]);
  expect(replacements.flatMap((r) => r.collection.features).map((f) => f.id)).toHaveLength(33);
  const landmarks = replacements[5]!.collection.features;
  expect(landmarks.filter((f) => f.id.startsWith('csnp-pdf-poi-'))).toHaveLength(15);
  expect(landmarks.filter((f) => f.properties.landmark_kind === 'waterfall')).toHaveLength(1);
  expect(
    landmarks.find((f) => f.properties.landmark_kind === 'waterfall')!.properties
      .source_annotations,
  ).toEqual([
    legacy.features.find(
      (f: { properties: { name: string } }) => f.properties.name === 'Waterfall',
    ),
  ]);
});
test.each([
  'duplicate',
  'empty',
  'missing-layer',
  'wrong-kind',
  'wrong-geometry',
  'bad-id',
  'provenance',
  'wrong-group',
  'invented-difficulty',
  'open-ring',
  'nonfinite',
  'range',
  'point',
])('rejects %s before persistence', (kind) => {
  const value = structuredClone(snapshot);
  const f = value.features[0]!;
  if (kind === 'duplicate') value.features.push(f);
  if (kind === 'empty') value.features = [];
  if (kind === 'missing-layer')
    value.features = value.features.filter((f) => f.properties.feature_kind !== 'water');
  if (kind === 'wrong-kind') f.properties.feature_kind = 'trail';
  if (kind === 'wrong-geometry') f.geometry = { type: 'Point', coordinates: [-84.48, 33.716] };
  if (kind === 'bad-id') f.id = 'csnp-pdf-water-001';
  if (kind === 'provenance') f.properties.source_sha256 = 'unknown';
  if (kind === 'wrong-group') f.properties.source_group = 'Legend';
  if (kind === 'invented-difficulty') f.properties.difficulty = 'easy';
  if (f.geometry.type === 'Polygon') {
    if (kind === 'open-ring') f.geometry.coordinates[0]!.pop();
    if (kind === 'nonfinite') f.geometry.coordinates[0]![0]![0] = NaN;
    if (kind === 'range') f.geometry.coordinates[0]![0]![0] = 180;
  }
  if (kind === 'point')
    value.features.find((f) => f.geometry.type === 'Point')!.geometry = {
      type: 'Point',
      coordinates: [0, 0],
    };
  expect(() => validatePdfMap(value)).toThrow();
});
const integration = process.env.GIS_INTEGRATION === '1' ? describe : describe.skip;
integration('selected PDF map → PostGIS → public API', () => {
  const url = localDatabaseUrl();
  const app = createApp({ layers: createLayersRepository(() => url) });
  const get = (id: string) => request(app).get(`/api/v1/layers/${id}/features`);
  beforeAll(async () => {
    await importSourceMap(url, legacy);
  });
  test('round-trips all properties, rings, holes and membership through HTTP', async () => {
    const catalog = (await request(app).get('/api/v1/layers')).body.layers;
    for (const { layer, collection } of pdfMapReplacements(snapshot)) {
      expect(catalog).toContainEqual(
        expect.objectContaining({
          layerId: layer.layerId,
          layerType: layer.layerType,
          pillar: null,
          isDemo: false,
        }),
      );
      const result = await get(layer.layerId);
      expect(result.status).toBe(200);
      expect(result.headers['content-type']).toContain('application/geo+json');
      expect(result.body.features).toEqual(
        [...collection.features].sort((a, b) => a.id.localeCompare(b.id)),
      );
    }
    const result = await withDatabase(url, (db) =>
      db.execute(
        sql`SELECT count(*)::int AS count FROM gis_feature WHERE feature_id LIKE 'csnp-pdf-%' AND ST_IsValid(geometry) AND ST_SRID(geometry)=4326`,
      ),
    );
    expect(result.rows[0]).toEqual({ count: 26 });
  });
  test('legacy replay and mixed concurrent writers cannot downgrade the boundary or landmarks; stale rows removed', async () => {
    const demo = (await get('demo-boundaries')).body;
    await withDatabase(url, (db) =>
      db.execute(
        sql`INSERT INTO gis_feature (feature_id,layer_id,geometry) VALUES ('old-guessed-boundary','cascade-map-boundary',ST_GeomFromText('POINT(0 0)',4326))`,
      ),
    );
    await Promise.all([
      importPdfMap(url, snapshot),
      importBoundaryMap(url, boundary),
      importSourceMap(url, legacy),
      importOfficialTrails(url, readOfficialTrails()),
    ]);
    for (const { layer, collection } of pdfMapReplacements(snapshot)) {
      expect((await get(layer.layerId)).body.features).toEqual(
        [...collection.features].sort((a, b) => a.id.localeCompare(b.id)),
      );
    }
    expect((await get('demo-boundaries')).body).toEqual(demo);
    expect((await get('cascade-map-trails')).body.features).toEqual(readOfficialTrails().features);
  });
  test('rolls back every context layer and metadata if a late polygon fails topology', async () => {
    const before = await Promise.all(pdfMapLayers.map(async (l) => (await get(l.layerId)).body));
    const invalid = structuredClone(snapshot);
    const building = invalid.features.find((f) => f.properties.feature_kind === 'building')!;
    building.geometry = {
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
    await expect(importPdfMap(url, invalid)).rejects.toThrow();
    expect(await Promise.all(pdfMapLayers.map(async (l) => (await get(l.layerId)).body))).toEqual(
      before,
    );
  });
  test('rolls back trails and all context on a retained annotation identity conflict', async () => {
    const before = (await get('cascade-map-trails')).body;
    const id = snapshot.features.find(
      (f) => f.properties.landmark_kind === 'source_annotation',
    )!.id;
    await withDatabase(url, (db) =>
      db.execute(sql`UPDATE gis_feature SET layer_id='demo-boundaries' WHERE feature_id=${id}`),
    );
    try {
      await expect(importSourceMap(url, legacy)).rejects.toThrow();
    } finally {
      await withDatabase(url, (db) =>
        db.execute(sql`DELETE FROM gis_feature WHERE feature_id=${id}`),
      );
      await importSourceMap(url, legacy);
    }
    expect((await get('cascade-map-trails')).body).toEqual(before);
  });
  test('bbox reads and private access apply to every PDF layer', async () => {
    for (const layer of pdfMapLayers) {
      expect(
        (
          await request(app).get(
            `/api/v1/layers/${layer.layerId}/features?bbox=-84.485,33.711,-84.474,33.721`,
          )
        ).body.features.length,
      ).toBeGreaterThan(0);
      expect(
        (await request(app).get(`/api/v1/layers/${layer.layerId}/features?bbox=0,0,1,1`)).body
          .features,
      ).toEqual([]);
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
        await importPdfMap(url, snapshot);
      }
    }
  });
});
