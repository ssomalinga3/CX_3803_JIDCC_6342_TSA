import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { withDatabase } from '../src/db/client.js';
import {
  importOfficialTrails,
  readOfficialTrails,
  validateOfficialTrails,
} from '../src/db/official-trails.js';
import { importSourceMap } from '../src/db/source-map.js';
import { replaceLayers } from '../src/db/gis-import.js';
import { officialTrailLayer } from '../src/db/official-trails.js';
import { createLayersRepository } from '../src/modules/gis/layers.repo.js';
import { localDatabaseUrl } from '../scripts/local-config.mjs';

const snapshot = JSON.parse(
  readFileSync(new URL('../../data/cascade-springs-gis/trails.geojson', import.meta.url), 'utf8'),
);
const legacy = JSON.parse(
  readFileSync(new URL('../../data/cascade-springs/features.geojson', import.meta.url), 'utf8'),
);

test('selected snapshot contains supplied identities and only measured/supplied optional attributes', () => {
  expect(readOfficialTrails()).toEqual(snapshot);
  expect(validateOfficialTrails(structuredClone(snapshot))).toEqual(snapshot);
  const features = snapshot.features;
  expect(features).toHaveLength(36);
  expect(
    features.reduce(
      (n: number, f: (typeof features)[number]) => n + f.geometry.coordinates.length,
      0,
    ),
  ).toBe(1901);
  expect(new Set(features.map((f: (typeof features)[number]) => f.id)).size).toBe(36);
  expect(
    new Set(features.map((f: (typeof features)[number]) => f.properties.trail_id).filter(Boolean))
      .size,
  ).toBe(9);
  expect(features.filter((f: (typeof features)[number]) => f.properties.difficulty)).toHaveLength(
    1,
  );
  expect(
    features.filter((f: (typeof features)[number]) => f.properties.average_width_in),
  ).toHaveLength(33);
  expect(
    features.filter(
      (f: (typeof features)[number]) => f.properties.name_assignment === 'unassigned',
    ),
  ).toHaveLength(1);
  expect(
    features.reduce((n: number, f: (typeof features)[number]) => n + f.properties.length_m, 0),
  ).toBeCloseTo(4098.856, 1);
  expect(JSON.stringify(snapshot)).not.toMatch(/CREATOR|EDITOR|C:\\\\Users/);
});

test.each([
  'duplicate',
  'source-id',
  'nonpublic',
  'flag-missing',
  'unknown-name',
  'route',
  'width-unit',
  'invented-difficulty',
  'raw-private-field',
  'extra-property',
  'provenance',
  'nonfinite',
  'outside',
  'short-line',
  'negative-length',
  'empty',
  'type',
])('rejects %s before persistence', (kind) => {
  const data = structuredClone(snapshot);
  const f = data.features[0];
  if (kind === 'duplicate') data.features.push(f);
  if (kind === 'source-id') f.id = 'csnp-official-trail-not-a-uuid';
  if (kind === 'nonpublic') f.properties.source_properties.PublishTra = 'FALSE';
  if (kind === 'flag-missing') delete f.properties.source_properties.PublishTra;
  if (kind === 'unknown-name') f.properties.source_properties.TRL_NM = 'Guessed Trail';
  if (kind === 'route') f.properties.trail_id = 'wrong';
  if (kind === 'width-unit') f.properties.average_width_in = 0;
  if (kind === 'invented-difficulty') f.properties.difficulty = 'easy';
  if (kind === 'raw-private-field') f.properties.source_properties.EDITOR = 'private';
  if (kind === 'extra-property') f.properties.recipient = 'private@example.com';
  if (kind === 'provenance') f.properties.source_archive_sha256 = 'unknown';
  if (kind === 'nonfinite') f.geometry.coordinates[0][0] = Infinity;
  if (kind === 'outside') f.geometry.coordinates[0][0] = 0;
  if (kind === 'short-line') f.geometry.coordinates = [f.geometry.coordinates[0]];
  if (kind === 'negative-length') f.properties.length_m = -1;
  if (kind === 'empty') data.features = [];
  if (kind === 'type') f.geometry.type = 'Point';
  expect(() => validateOfficialTrails(data)).toThrow();
});

test('replacement rejects duplicate assignment and unsupported geometry before connecting', async () => {
  const collection = readOfficialTrails();
  await expect(
    replaceLayers('unused', 2, [
      { layer: officialTrailLayer, collection },
      { layer: { ...officialTrailLayer, layerId: 'another-trail-layer' }, collection },
    ]),
  ).rejects.toThrow('Duplicate layer assignment');
  await expect(
    replaceLayers('unused', 2, [
      { layer: { ...officialTrailLayer, geometryType: 'Point' }, collection },
    ]),
  ).rejects.toThrow('unsupported replacement geometry');
});

const integration = process.env.GIS_INTEGRATION === '1' ? describe : describe.skip;
integration('supplied trails → PostGIS → API', () => {
  const url = localDatabaseUrl();
  const app = createApp({ layers: createLayersRepository(() => url) });
  const get = () => request(app).get('/api/v1/layers/cascade-map-trails/features');
  beforeAll(async () => {
    await importSourceMap(url, legacy);
  });
  afterEach(async () => {
    await importSourceMap(url, legacy);
  });

  it('round-trips every source segment, raw field and coordinate with nullable pillar', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body.features).toEqual(snapshot.features);
    const catalog = await request(app).get('/api/v1/layers');
    expect(
      catalog.body.layers.find((l: { layerId: string }) => l.layerId === 'cascade-map-trails'),
    ).toMatchObject({ pillar: null, isDemo: false, name: 'Cascade Springs trails (supplied GIS)' });
    const rows = await withDatabase(url, (db) =>
      db.execute(
        sql`SELECT count(*)::int AS count, sum(ST_NPoints(geometry))::int AS vertices FROM gis_feature WHERE layer_id = 'cascade-map-trails' AND ST_IsValid(geometry) AND ST_SRID(geometry) = 4326`,
      ),
    );
    expect(rows.rows[0]).toEqual({ count: 36, vertices: 1901 });
  });
  it('replaces old sections and stale IDs, replays concurrently with legacy writers, and preserves other layers', async () => {
    const landmarks = (await request(app).get('/api/v1/layers/cascade-map-landmarks/features'))
      .body;
    const unrelated = (await request(app).get('/api/v1/layers/demo-boundaries/features')).body;
    await withDatabase(url, (db) =>
      db.execute(
        sql`INSERT INTO gis_feature (feature_id, layer_id, geometry, properties) VALUES ('old-approximate-section', 'cascade-map-trails', ST_GeomFromText('LINESTRING(-84.48 33.715,-84.481 33.716)',4326), '{"name_assignment":"approximate"}')`,
      ),
    );
    await Promise.all([
      importOfficialTrails(url, snapshot),
      importSourceMap(url, legacy),
      importOfficialTrails(url, snapshot),
    ]);
    expect((await get()).body.features).toEqual(snapshot.features);
    expect((await request(app).get('/api/v1/layers/cascade-map-landmarks/features')).body).toEqual(
      landmarks,
    );
    expect((await request(app).get('/api/v1/layers/demo-boundaries/features')).body).toEqual(
      unrelated,
    );
    // A conversion that excludes a newly nonpublic segment removes the stale public row.
    const reduced = structuredClone(snapshot);
    reduced.features.shift();
    await importOfficialTrails(url, reduced);
    expect((await get()).body.features).toEqual(reduced.features);
    await importSourceMap(url, legacy);
    expect((await get()).body.features).toEqual(snapshot.features);
  });
  it('rolls back all features if PostGIS rejects a structurally valid degenerate line', async () => {
    const before = (await get()).body;
    const invalid = structuredClone(snapshot);
    const point = invalid.features[invalid.features.length - 1].geometry.coordinates[0];
    invalid.features[invalid.features.length - 1].geometry.coordinates = [point, point];
    await expect(importOfficialTrails(url, invalid)).rejects.toThrow();
    expect((await get()).body).toEqual(before);
  });
  it('supports bbox intersection and applies public access restrictions to supplied geometry', async () => {
    const [x, y] = snapshot.features[0].geometry.coordinates[0];
    const box = `${x - 0.000001},${y - 0.000001},${x + 0.000001},${y + 0.000001}`;
    const hit = await request(app).get(`/api/v1/layers/cascade-map-trails/features?bbox=${box}`);
    expect(hit.body.features.map((f: { id: string }) => f.id)).toContain(snapshot.features[0].id);
    expect(
      (await request(app).get('/api/v1/layers/cascade-map-trails/features?bbox=0,0,1,1')).body
        .features,
    ).toEqual([]);
    await withDatabase(url, (db) =>
      db.execute(sql`UPDATE gis_layer SET is_public=false WHERE layer_id='cascade-map-trails'`),
    );
    const hidden = await get();
    expect(hidden.status).toBe(404);
    expect(
      (await request(app).get('/api/v1/layers')).body.layers.map(
        (l: { layerId: string }) => l.layerId,
      ),
    ).not.toContain('cascade-map-trails');
  });
});
