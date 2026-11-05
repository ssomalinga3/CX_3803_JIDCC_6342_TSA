import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { withDatabase } from '../src/db/client.js';
import { importSourceMap, sourceMapLayers, validateSourceMap } from '../src/db/source-map.js';
import { createLayersRepository } from '../src/modules/gis/layers.repo.js';
import { localDatabaseUrl } from '../scripts/local-config.mjs';
import { splitSourceMapTrails } from '../src/db/source-map-trails.js';

const path = new URL('../../data/cascade-springs/features.geojson', import.meta.url);
const snapshot = JSON.parse(readFileSync(path, 'utf8'));
const displaySnapshot = splitSourceMapTrails(snapshot);

describe('source map snapshot', () => {
  it('splits the entire traversal without losing, moving or inventing coordinates', () => {
    const before = structuredClone(snapshot);
    const sections = splitSourceMapTrails(snapshot).features.filter(
      (feature) => feature.geometry.type === 'LineString',
    );
    expect(sections).toHaveLength(10);
    expect(new Set(sections.map((section) => section.id)).size).toBe(10);
    expect(
      sections.flatMap((section, index) => {
        if (section.geometry.type !== 'LineString') throw new Error('Expected line');
        return index ? section.geometry.coordinates.slice(1) : section.geometry.coordinates;
      }),
    ).toEqual(snapshot.features[0].geometry.coordinates);
    expect(
      splitSourceMapTrails(snapshot).features.filter(
        (feature) => feature.geometry.type === 'Point',
      ),
    ).toEqual(snapshot.features.slice(1));
    expect(snapshot).toEqual(before);
  });
  it('publishes only seven approximate identities with provenance and leaves uncertain sections unnamed', () => {
    const sections = displaySnapshot.features.filter(
      (feature) => feature.geometry.type === 'LineString',
    );
    expect(
      [
        ...new Set(
          sections.flatMap((section) =>
            section.properties.trail_id ? [section.properties.name] : [],
          ),
        ),
      ].sort(),
    ).toEqual([
      'Battle Ridge Trail',
      'Gateway Trail',
      'Springs Trail',
      'Terrace Trail',
      'Turkeyfoot/Utoy Creek Trail',
      'West Trail',
      'White Oak Trail',
    ]);
    for (const section of sections) {
      expect(section.properties).toMatchObject({
        source_feature_id: snapshot.features[0].id,
        source_name: snapshot.features[0].properties.name,
        source_url: snapshot.features[0].properties.source_url,
      });
      expect(section.properties.difficulty).toBeUndefined();
      expect(section.properties.length_m).toBeUndefined();
      if (section.properties.trail_id) {
        expect(section.properties.feature_kind).toBe('trail');
        expect(section.properties.name_assignment).toBe('approximate');
        expect(section.properties.name_source).toContain('cascade-springs-trail-network.png');
      } else {
        expect(section.properties.name_assignment).toBe('unassigned');
        expect(section.properties.name).toBe('Unnamed trail connection');
      }
    }
    expect(sections.filter((section) => !section.properties.trail_id)).toHaveLength(2);
    expect(splitSourceMapTrails(snapshot)).toEqual(displaySnapshot);
  });
  it('requires a new review when the original route changes, before assigning index-based names', () => {
    const changed = structuredClone(snapshot);
    changed.features[0].geometry.coordinates[20][0] += 0.000001;
    expect(() => splitSourceMapTrails(changed)).toThrow('Source route changed');
    expect(() =>
      splitSourceMapTrails({ ...snapshot, features: snapshot.features.slice(1) }),
    ).toThrow('Source route changed');
  });
  it('reproduces every source placemark, coordinate and description from KML', () => {
    // Compare without rewriting the checked-in artifact (Prettier controls its layout).
    const script = fileURLToPath(new URL('../scripts/convert-source-map.py', import.meta.url));
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
      const expected = displaySnapshot.features.filter(
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
    expect(validity.rows[0]).toEqual({ count: 18 });
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
    const unrelatedBefore = await request(app).get('/api/v1/layers/demo-boundaries/features');
    await Promise.all([importSourceMap(url, snapshot), importSourceMap(url, snapshot)]);
    const trails = await request(app).get('/api/v1/layers/cascade-map-trails/features');
    const points = await request(app).get('/api/v1/layers/cascade-map-landmarks/features');
    expect(trails.body.features).toHaveLength(10);
    expect(points.body.features).toHaveLength(8);
    expect((await request(app).get('/api/v1/layers/demo-boundaries/features')).body).toEqual(
      unrelatedBefore.body,
    );
  });
  it('rolls back the complete replacement if PostGIS rejects a geometry', async () => {
    const before = await request(app).get('/api/v1/layers/cascade-map-trails/features');
    const invalid = structuredClone(snapshot);
    // Keep the reviewed route intact so this reaches PostGIS, rather than being
    // rejected earlier by the source-geometry hash guard.
    invalid.features.push({
      ...structuredClone(snapshot.features[0]),
      id: 'cascade-map-0000000000000000',
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [0, 0],
        ],
      },
    });
    await expect(importSourceMap(url, invalid)).rejects.toThrow();
    expect((await request(app).get('/api/v1/layers/cascade-map-trails/features')).body).toEqual(
      before.body,
    );
  });
});
