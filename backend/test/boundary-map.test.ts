import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { withDatabase } from '../src/db/client.js';
import {
  importBoundaryMap,
  boundaryMapLayers,
  validateBoundaryMap,
} from '../src/db/boundary-map.js';
import { importSourceMap } from '../src/db/source-map.js';
import { createLayersRepository } from '../src/modules/gis/layers.repo.js';
import { localDatabaseUrl } from '../scripts/local-config.mjs';

const path = new URL('../../data/cascade-springs/approximate-boundary.geojson', import.meta.url);
const snapshot = JSON.parse(readFileSync(path, 'utf8'));
const sourcePath = new URL('../../data/cascade-springs/features.geojson', import.meta.url);
const sourceSnapshot = JSON.parse(readFileSync(sourcePath, 'utf8'));

describe('boundary snapshot', () => {
  it('validates one approximate preserve boundary polygon with a closed ring', () => {
    const collection = validateBoundaryMap(snapshot);
    expect(collection.features).toHaveLength(1);
    const feature = collection.features[0]!;
    expect(feature.geometry.type).toBe('Polygon');
    expect(feature.properties).toMatchObject({
      feature_kind: 'boundary',
      boundary_kind: 'preserve',
      name_assignment: 'approximate',
    });
    if (feature.geometry.type !== 'Polygon') throw new Error('Expected polygon');
    const ring = feature.geometry.coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });
  it.each([
    'duplicate',
    'empty',
    'id',
    'type',
    'kind',
    'assignment',
    'range',
    'nonfinite',
    'open-ring',
    'short-ring',
  ])('rejects %s before persistence', (kind) => {
    const data = structuredClone(snapshot);
    if (kind === 'duplicate') data.features.push(data.features[0]);
    if (kind === 'empty') data.features = [];
    if (kind === 'id') data.features[0].id = 'not-a-boundary-id';
    if (kind === 'type') data.features[0].geometry.type = 'LineString';
    if (kind === 'kind') data.features[0].properties.feature_kind = 'trail';
    if (kind === 'assignment') data.features[0].properties.name_assignment = 'authoritative';
    if (kind === 'range') data.features[0].geometry.coordinates[0][0][0] = 181;
    if (kind === 'nonfinite') data.features[0].geometry.coordinates[0][0][1] = Infinity;
    if (kind === 'open-ring') data.features[0].geometry.coordinates[0].pop();
    if (kind === 'short-ring') data.features[0].geometry.coordinates[0] = [[0, 0]];
    expect(() => validateBoundaryMap(data)).toThrow();
  });
});

const integration = process.env.GIS_INTEGRATION === '1' ? describe : describe.skip;
integration('boundary map → PostGIS → public API', () => {
  const url = localDatabaseUrl();
  const app = createApp({ layers: createLayersRepository(() => url) });
  beforeAll(async () => {
    await importBoundaryMap(url, snapshot);
  });
  it('publishes the boundary layer as non-demo with approximate provenance over HTTP', async () => {
    const catalog = await request(app).get('/api/v1/layers');
    for (const layer of boundaryMapLayers) {
      expect(catalog.body.layers).toContainEqual(
        expect.objectContaining({
          layerId: layer.layerId,
          isDemo: false,
          pillar: null,
          layerType: 'boundary',
        }),
      );
      const response = await request(app).get(`/api/v1/layers/${layer.layerId}/features`);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/geo+json');
      expect(response.body.features).toHaveLength(1);
      expect(response.body.features[0]).toMatchObject({
        id: snapshot.features[0].id,
        geometry: { type: 'Polygon' },
        properties: { feature_kind: 'boundary', name_assignment: 'approximate' },
      });
    }
    const validity = await withDatabase(url, (db) =>
      db.execute(sql`
      SELECT count(*)::int AS count FROM gis_feature WHERE layer_id = 'cascade-map-boundary' AND ST_SRID(geometry) = 4326 AND ST_IsValid(geometry)`),
    );
    expect(validity.rows[0]).toEqual({ count: 1 });
  });
  it('filters the boundary with a bbox and returns nothing outside its extent', async () => {
    const [x, y] = snapshot.features[0].geometry.coordinates[0][0];
    const hit = await request(app).get(
      `/api/v1/layers/cascade-map-boundary/features?bbox=${x - 0.01},${y - 0.01},${x + 0.01},${y + 0.01}`,
    );
    expect(hit.body.features.map((f: { id: string }) => f.id)).toEqual([snapshot.features[0].id]);
    const empty = await request(app).get(
      '/api/v1/layers/cascade-map-boundary/features?bbox=0,0,1,1',
    );
    expect(empty.body.features).toEqual([]);
  });
  it('serializes concurrent imports, removes stale features, and preserves unrelated layers', async () => {
    await withDatabase(url, (db) =>
      db.execute(
        sql`INSERT INTO gis_feature (feature_id, layer_id, geometry) VALUES ('boundary-stale-test', 'cascade-map-boundary', ST_GeomFromText('POINT(0 0)',4326))`,
      ),
    );
    await importSourceMap(url, sourceSnapshot);
    const unrelatedBefore = await request(app).get('/api/v1/layers/cascade-map-trails/features');
    await Promise.all([importBoundaryMap(url, snapshot), importBoundaryMap(url, snapshot)]);
    const boundary = await request(app).get('/api/v1/layers/cascade-map-boundary/features');
    expect(boundary.body.features).toHaveLength(1);
    expect(boundary.body.features.map((f: { id: string }) => f.id)).toEqual([
      snapshot.features[0].id,
    ]);
    expect((await request(app).get('/api/v1/layers/cascade-map-trails/features')).body).toEqual(
      unrelatedBefore.body,
    );
  });
  it('rolls back the replacement if PostGIS rejects a geometry', async () => {
    const before = await request(app).get('/api/v1/layers/cascade-map-boundary/features');
    const invalid = structuredClone(snapshot);
    // A self-intersecting bowtie ring passes structural validation but fails the
    // PostGIS ST_IsValid check, reaching the transaction.
    invalid.features[0].geometry.coordinates = [
      [
        [0, 0],
        [1, 1],
        [1, 0],
        [0, 1],
        [0, 0],
      ],
    ];
    await expect(importBoundaryMap(url, invalid)).rejects.toThrow();
    expect((await request(app).get('/api/v1/layers/cascade-map-boundary/features')).body).toEqual(
      before.body,
    );
  });
});
