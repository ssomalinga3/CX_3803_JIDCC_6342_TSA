import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { withDatabase } from '../src/db/client.js';
import { seedDemo } from '../src/db/demo-seed.js';
import { gisLayer } from '../src/db/schema.js';
import { createLayersRepository } from '../src/modules/gis/layers.repo.js';
import { localDatabaseUrl } from '../scripts/local-config.mjs';

// Default unit checks need no database. Explicit command/CI enables real PostGIS tests.
const integration = process.env.GIS_INTEGRATION === '1' ? describe : describe.skip;
integration('public GIS with real PostGIS', () => {
  const url = localDatabaseUrl();
  const app = createApp({ layers: createLayersRepository(() => url) });
  beforeAll(async () => {
    await seedDemo(url);
    await withDatabase(url, async (db) => {
      await db.insert(gisLayer).values([
        {
          layerId: 'test-gis-private',
          name: 'Private',
          description: 'Test',
          layerType: 'test',
          source: 'test',
        },
        {
          layerId: 'test-gis-empty',
          name: 'Empty',
          description: 'Test',
          layerType: 'test',
          source: 'test',
          isPublic: true,
        },
        {
          layerId: 'test-gis-spatial',
          name: 'Spatial',
          description: 'Test',
          layerType: 'test',
          source: 'test',
          isPublic: true,
        },
      ]);
      await db.execute(sql`INSERT INTO gis_feature (feature_id, layer_id, geometry) VALUES
        ('test-gis-hidden', 'test-gis-private', ST_GeomFromText('POINT(0 0)', 4326)),
        ('test-gis-line', 'test-gis-spatial', ST_GeomFromText('LINESTRING(0 0, 2 2)', 4326))`);
    });
  });
  afterAll(async () => {
    await withDatabase(url, async (db) => {
      await db.execute(
        sql`DELETE FROM gis_feature WHERE layer_id IN ('test-gis-private', 'test-gis-spatial')`,
      );
      await db.execute(
        sql`DELETE FROM gis_layer WHERE layer_id IN ('test-gis-private', 'test-gis-spatial', 'test-gis-empty')`,
      );
    });
  });

  it('lists only public metadata and labels demo provenance', async () => {
    const response = await request(app).get('/api/v1/layers');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(
      response.body.layers.some(
        (layer: { layerId: string }) => layer.layerId === 'test-gis-private',
      ),
    ).toBe(false);
    expect(response.body.layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layerId: 'demo-trails',
          isDemo: true,
          pillar: null,
          source: 'Repository synthetic demo fixtures v1',
          featuresUrl: '/api/v1/layers/demo-trails/features',
        }),
      ]),
    );
  });
  it.each([
    ['demo-trails', 'LineString', 2],
    ['demo-boundaries', 'Polygon', 1],
    ['demo-landmarks', 'Point', 2],
  ])('returns GeoJSON for %s', async (id, geometryType, count) => {
    const response = await request(app).get(`/api/v1/layers/${id}/features`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/geo+json');
    expect(response.body.type).toBe('FeatureCollection');
    expect(response.body.features).toHaveLength(count as number);
    expect(response.body.features[0]).toMatchObject({
      type: 'Feature',
      id: expect.any(String),
      geometry: { type: geometryType },
      properties: { isDemo: true },
    });
    if (geometryType === 'Point')
      expect(response.body.features[0].geometry.coordinates).toEqual([-84.48, 33.72]);
  });
  it('returns identical uncached 404s for unknown and private layers, including bbox requests', async () => {
    for (const suffix of ['', '?bbox=-1,-1,1,1']) {
      const missing = await request(app).get(`/api/v1/layers/unknown/features${suffix}`);
      const hidden = await request(app).get(`/api/v1/layers/test-gis-private/features${suffix}`);
      expect(hidden.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(hidden.body).toEqual(missing.body);
      expect(hidden.body).toEqual({
        error: { code: 'NOT_FOUND', message: 'Resource not found', fields: {} },
      });
      expect(hidden.headers['cache-control']).toBe('no-store');
    }
  });
  it('returns an empty collection for empty layers and nonintersecting viewports', async () => {
    for (const path of ['test-gis-empty/features', 'demo-trails/features?bbox=0,0,1,1']) {
      const response = await request(app).get(`/api/v1/layers/${path}`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ type: 'FeatureCollection', features: [] });
    }
  });
  it('uses exact intersection, includes edges, and does not clip geometries', async () => {
    const get = (bbox: string) =>
      request(app).get(`/api/v1/layers/test-gis-spatial/features?bbox=${bbox}`);
    expect((await get('0,1,0.5,2')).body.features).toHaveLength(0); // envelopes overlap, line does not
    const edge = await get('1,0,2,1');
    expect(edge.body.features).toHaveLength(1);
    expect(edge.body.features[0].geometry.coordinates).toEqual([
      [0, 0],
      [2, 2],
    ]);
    const points = await request(app).get(
      '/api/v1/layers/demo-landmarks/features?bbox=-84.481,33.719,-84.479,33.721',
    );
    expect(points.body.features.map((f: { id: string }) => f.id)).toEqual(['demo-landmark-1']);
  });
  it('preserves counts and stable IDs on repeated seeding', async () => {
    const before = await request(app).get('/api/v1/layers/demo-trails/features');
    await seedDemo(url);
    await seedDemo(url);
    expect((await request(app).get('/api/v1/layers/demo-trails/features')).body).toEqual(
      before.body,
    );
    const result = await withDatabase(url, (db) =>
      db.execute<{ layers: number; features: number }>(sql`
      SELECT (SELECT count(*)::int FROM gis_layer WHERE layer_id IN ('demo-trails','demo-boundaries','demo-landmarks')) AS layers,
             (SELECT count(*)::int FROM gis_feature WHERE layer_id IN ('demo-trails','demo-boundaries','demo-landmarks')) AS features`),
    );
    expect(result.rows[0]).toEqual({ layers: 3, features: 5 });
  });
  it('enforces the FK, SRID, valid geometry, object properties and spatial index', async () => {
    await expect(
      withDatabase(url, (db) =>
        db.execute(
          sql`INSERT INTO gis_feature VALUES ('test-bad', 'unknown', ST_GeomFromText('POINT(0 0)',4326), '{}')`,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      withDatabase(url, (db) =>
        db.execute(
          sql`INSERT INTO gis_feature VALUES ('test-bad', 'demo-trails', ST_GeomFromText('POINT(0 0)',3857), '{}')`,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      withDatabase(url, (db) =>
        db.execute(
          sql`INSERT INTO gis_feature VALUES ('test-bad', 'demo-trails', ST_GeomFromText('POINT EMPTY',4326), '{}')`,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      withDatabase(url, (db) =>
        db.execute(
          sql`INSERT INTO gis_feature VALUES ('test-bad', 'demo-trails', ST_GeomFromText('POINT(0 0)',4326), '[]')`,
        ),
      ),
    ).rejects.toThrow();
    const indexes = await withDatabase(url, (db) =>
      db.execute<{ indexdef: string }>(
        sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'gis_feature' AND indexname = 'gis_feature_geometry_gist'`,
      ),
    );
    expect(indexes.rows[0]?.indexdef).toContain('USING gist (geometry)');
  });
});

describe('GIS input validation and failure redaction', () => {
  const app = createApp();
  it.each([
    '',
    '1,2,3',
    '0,0,1,1,2',
    'a,0,1,1',
    '0,,1,1',
    'NaN,0,1,1',
    '-181,0,1,1',
    '0,-91,1,1',
    '0,0,181,1',
    '0,0,1,91',
    '2,0,1,1',
    '0,2,1,1',
    '0,0,0,1',
    '170,0,-170,1',
    '0,0,1,1&bbox=0,0,2,2',
  ])('rejects malformed bbox %s before querying', async (bbox) => {
    const response = await request(app).get(`/api/v1/layers/demo-trails/features?bbox=${bbox}`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_BBOX');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('redacts repository failures', async () => {
    const failing = async (): Promise<never> => {
      throw new Error('secret connection details');
    };
    const failingApp = createApp({
      layers: { listPublicLayers: failing, getPublicLayerFeatures: failing },
    });
    for (const path of ['/api/v1/layers', '/api/v1/layers/demo-trails/features']) {
      const response = await request(failingApp).get(path);
      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Layer data is unavailable', fields: {} },
      });
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });
});
