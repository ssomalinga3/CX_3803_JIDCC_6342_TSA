import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { withDatabase } from '../src/db/client.js';
import { importSourceMap, sourceMapLayers, validateSourceMap } from '../src/db/source-map.js';
import { createLayersRepository } from '../src/modules/gis/layers.repo.js';
import { localDatabaseUrl } from '../scripts/local-config.mjs';

const path = new URL('../../data/cascade-springs/features.geojson', import.meta.url);
const snapshot = JSON.parse(readFileSync(path, 'utf8'));

describe('source map snapshot', () => {
  it('reproduces every source placemark, coordinate and description from KML', () => {
    // Compare without rewriting the checked-in artifact (Prettier controls its layout).
    const script = new URL('../scripts/convert-source-map.py', import.meta.url).pathname;
    const converted = execFileSync(
      'python3',
      [
        '-c',
        'import runpy,json; m=runpy.run_path(__import__("sys").argv[1]); print(json.dumps(m["convert"]((m["DATA"]/"source.kml").read_bytes())))',
        script,
      ],
      { encoding: 'utf8' },
    );
    expect(JSON.parse(converted)).toEqual(snapshot);
    expect(validateSourceMap(snapshot).features).toHaveLength(9);
    expect(
      snapshot.features.filter(
        (f: { geometry: { type: string } }) => f.geometry.type === 'LineString',
      ),
    ).toHaveLength(1);
    expect(snapshot.features[0].geometry.coordinates).toHaveLength(191);
    expect(
      snapshot.features.find(
        (f: { properties: { name: string } }) => f.properties.name === 'Park boundary / fence',
      ).geometry.type,
    ).toBe('Point');
  });
  it.each(['duplicate', 'range', 'empty', 'type', 'provenance', 'nonfinite', 'short-line'])(
    'rejects %s before persistence',
    (kind) => {
      const data = structuredClone(snapshot);
      if (kind === 'duplicate') data.features.push(data.features[0]);
      if (kind === 'range') data.features[0].geometry.coordinates[0][0] = 181;
      if (kind === 'nonfinite') data.features[0].geometry.coordinates[0][1] = Infinity;
      if (kind === 'empty') data.features = [];
      if (kind === 'type') data.features[0].geometry.type = 'Polygon';
      if (kind === 'provenance') data.features[0].properties.source_url = 'unknown';
      if (kind === 'short-line') data.features[0].geometry.coordinates = [[0, 0]];
      expect(() => validateSourceMap(data)).toThrow();
    },
  );
});

const integration = process.env.GIS_INTEGRATION === '1' ? describe : describe.skip;
integration('source map → PostGIS → public API', () => {
  const url = localDatabaseUrl();
  const app = createApp({ layers: createLayersRepository(() => url) });
  beforeAll(async () => {
    await importSourceMap(url, snapshot);
  });
  it('preserves all source geometry, IDs, descriptions and metadata over HTTP', async () => {
    const catalog = await request(app).get('/api/v1/layers');
    for (const layer of sourceMapLayers) {
      expect(catalog.body.layers).toContainEqual(
        expect.objectContaining({
          layerId: layer.layerId,
          isDemo: false,
          pillar: null,
          layerType: layer.layerType,
        }),
      );
      const response = await request(app).get(`/api/v1/layers/${layer.layerId}/features`);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/geo+json');
      const expected = snapshot.features.filter(
        (f: { geometry: { type: string } }) => f.geometry.type === layer.geometryType,
      );
      expect(response.body.features).toEqual(
        [...expected].sort((a, b) => a.id.localeCompare(b.id)),
      );
    }
    const validity = await withDatabase(url, (db) =>
      db.execute(sql`
      SELECT count(*)::int AS count FROM gis_feature WHERE layer_id IN ('cascade-map-trails', 'cascade-map-landmarks') AND ST_SRID(geometry) = 4326 AND ST_IsValid(geometry)`),
    );
    expect(validity.rows[0]).toEqual({ count: 9 });
  });
  it('filters source geometry with a bbox and returns no features outside the preserve', async () => {
    const point = snapshot.features.find(
      (f: { properties: { name: string } }) => f.properties.name === 'Trailhead',
    );
    const [x, y] = point.geometry.coordinates;
    const response = await request(app).get(
      `/api/v1/layers/cascade-map-landmarks/features?bbox=${x - 0.000001},${y - 0.000001},${x + 0.000001},${y + 0.000001}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.features.map((f: { id: string }) => f.id)).toEqual([point.id]);
    const empty = await request(app).get('/api/v1/layers/cascade-map-trails/features?bbox=0,0,1,1');
    expect(empty.body.features).toEqual([]);
  });
  it('serializes concurrent imports, removes stale source features, and preserves unrelated layers', async () => {
    await withDatabase(url, (db) =>
      db.execute(
        sql`INSERT INTO gis_feature (feature_id, layer_id, geometry) VALUES ('source-map-stale-test', 'cascade-map-trails', ST_GeomFromText('POINT(0 0)',4326))`,
      ),
    );
    const unrelatedBefore = await request(app).get('/api/v1/layers/demo-trails/features');
    await Promise.all([importSourceMap(url, snapshot), importSourceMap(url, snapshot)]);
    const trails = await request(app).get('/api/v1/layers/cascade-map-trails/features');
    const points = await request(app).get('/api/v1/layers/cascade-map-landmarks/features');
    expect(trails.body.features).toHaveLength(1);
    expect(points.body.features).toHaveLength(8);
    expect((await request(app).get('/api/v1/layers/demo-trails/features')).body).toEqual(
      unrelatedBefore.body,
    );
  });
  it('rolls back the complete replacement if PostGIS rejects a geometry', async () => {
    const before = await request(app).get('/api/v1/layers/cascade-map-trails/features');
    const invalid = structuredClone(snapshot);
    invalid.features[0].geometry.coordinates = [
      [0, 0],
      [0, 0],
    ];
    await expect(importSourceMap(url, invalid)).rejects.toThrow();
    expect((await request(app).get('/api/v1/layers/cascade-map-trails/features')).body).toEqual(
      before.body,
    );
  });
});
