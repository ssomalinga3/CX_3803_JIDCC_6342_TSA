import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { withDatabase } from '../src/db/client.js';
import { gisLayer } from '../src/db/schema.js';
import { createLayersRepository } from '../src/modules/gis/layers.repo.js';
import type { Geometry } from '../src/modules/gis/types.js';
import {
  trailNetworkGeometryTypes,
  type TrailNetworkProperties,
} from '../src/modules/gis/trail-network.js';
import { localDatabaseUrl } from '../scripts/local-config.mjs';

it('keeps the sign inventory separate from published GIS and covers every geometry family', () => {
  const catalog = JSON.parse(
    readFileSync(new URL('../../data/trail-network/catalog.json', import.meta.url), 'utf8'),
  );
  expect(catalog.status).toBe('trails-context-and-terrain-integrated');
  expect(catalog.trails).toHaveLength(9);
  expect(new Set(catalog.trails.map((trail: { trail_id: string }) => trail.trail_id)).size).toBe(9);
  for (const trail of catalog.trails) {
    expect(trail.status).toBe('supplied-gis');
    expect(trail.geometry).toBeUndefined();
  }
  expect(
    Object.fromEntries(
      catalog.layers.map((layer: { layer_type: string; geometry_types: string[] }) => [
        layer.layer_type,
        layer.geometry_types,
      ]),
    ),
  ).toEqual(trailNetworkGeometryTypes);
});

const integration = process.env.GIS_INTEGRATION === '1' ? describe : describe.skip;
integration('future network attributes through existing PostGIS and API', () => {
  const url = localDatabaseUrl();
  const app = createApp({ layers: createLayersRepository(() => url) });
  // Explicitly synthetic test coordinates, never seeded as preserve GIS.
  const line: Geometry = {
    type: 'MultiLineString',
    coordinates: [
      [
        [0, 0],
        [1, 1],
      ],
    ],
  };
  const area: Geometry = {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    ],
  };
  const fixtures: { geometry: Geometry; properties: TrailNetworkProperties }[] = [
    {
      geometry: line,
      properties: {
        name: 'Test trail segment',
        feature_kind: 'trail',
        trail_id: 'test-route',
        difficulty: 'moderate',
        color: '#804080',
        length_m: 100,
        surface_type: 'natural',
      },
    },
    {
      geometry: line,
      properties: {
        name: 'Unknown difficulty segment',
        feature_kind: 'trail',
        trail_id: 'test-route',
      },
    },
    {
      geometry: area,
      properties: { name: 'Test preserve', feature_kind: 'boundary', boundary_kind: 'preserve' },
    },
    {
      geometry: area,
      properties: {
        name: 'Test protective area',
        feature_kind: 'boundary',
        boundary_kind: 'protective',
      },
    },
    {
      geometry: {
        type: 'MultiPoint',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      properties: {
        name: 'Test picnic areas',
        feature_kind: 'landmark',
        landmark_kind: 'picnic_area',
      },
    },
    {
      geometry: line,
      properties: { name: 'Test stream', feature_kind: 'water', water_kind: 'stream' },
    },
    { geometry: area, properties: { name: 'Test natural area', feature_kind: 'natural_area' } },
    { geometry: line, properties: { name: 'Test road', feature_kind: 'road' } },
  ];
  beforeAll(async () => {
    await withDatabase(url, (db) =>
      db.transaction(async (tx) => {
        await tx.insert(gisLayer).values({
          layerId: 'test-trail-network',
          name: 'Test network',
          description: 'Synthetic integration fixtures only',
          layerType: 'test',
          source: 'test',
          isPublic: true,
          isDemo: true,
        });
        for (const [index, feature] of fixtures.entries()) {
          await tx.execute(
            sql`INSERT INTO gis_feature (feature_id, layer_id, geometry, properties) VALUES (${`test-trail-network-${index}`}, 'test-trail-network', ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(feature.geometry)}),4326), ${JSON.stringify(feature.properties)}::jsonb)`,
          );
        }
      }),
    );
  });
  afterAll(async () => {
    await withDatabase(url, async (db) => {
      await db.execute(sql`DELETE FROM gis_feature WHERE layer_id = 'test-trail-network'`);
      await db.execute(sql`DELETE FROM gis_layer WHERE layer_id = 'test-trail-network'`);
    });
  });
  it('round-trips all planned feature families, shared route identity and unknown difficulty', async () => {
    const response = await request(app).get('/api/v1/layers/test-trail-network/features');
    expect(response.status).toBe(200);
    expect(response.body.features).toEqual(
      fixtures.map((feature, index) => ({
        type: 'Feature',
        id: `test-trail-network-${index}`,
        ...feature,
      })),
    );
    expect(response.body.features[1].properties.difficulty).toBeUndefined();
  });
});
