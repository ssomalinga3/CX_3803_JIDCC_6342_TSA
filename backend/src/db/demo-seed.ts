import { sql } from 'drizzle-orm';
import { withDatabase } from './client.js';
import { gisLayer } from './schema.js';

/** Synthetic Atlanta-area shapes, not surveyed preserve boundaries or navigation data. */
const fixtures = [
  {
    layerId: 'demo-trails',
    layerType: 'trail',
    name: 'Synthetic demo trails',
    features: [
      {
        id: 'demo-trail-1',
        name: 'Demo loop segment',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-84.48, 33.72],
            [-84.478, 33.722],
            [-84.476, 33.721],
          ],
        },
        surface_type: 'durable',
      },
      {
        id: 'demo-trail-2',
        name: 'Demo connector',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-84.478, 33.722],
            [-84.477, 33.724],
          ],
        },
        surface_type: 'natural',
      },
    ],
  },
  {
    layerId: 'demo-boundaries',
    layerType: 'boundary',
    name: 'Synthetic demo boundary',
    features: [
      {
        id: 'demo-boundary-1',
        name: 'Demo area (not preserve boundary)',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-84.482, 33.718],
              [-84.474, 33.718],
              [-84.474, 33.726],
              [-84.482, 33.726],
              [-84.482, 33.718],
            ],
          ],
        },
      },
    ],
  },
  {
    layerId: 'demo-landmarks',
    layerType: 'landmark',
    name: 'Synthetic demo landmarks',
    features: [
      {
        id: 'demo-landmark-1',
        name: 'Demo trailhead',
        geometry: { type: 'Point', coordinates: [-84.48, 33.72] },
      },
      {
        id: 'demo-landmark-2',
        name: 'Demo overlook',
        geometry: { type: 'Point', coordinates: [-84.477, 33.724] },
      },
    ],
  },
];

export async function seedDemo(connectionString: string): Promise<void> {
  await withDatabase(connectionString, (db) =>
    db.transaction(async (tx) => {
      // Serializes concurrent seed invocations as well as making reruns idempotent.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6342, 1)`);
      for (const layer of fixtures) {
        const metadata = {
          layerId: layer.layerId,
          name: layer.name,
          layerType: layer.layerType,
          description:
            'Synthetic development fixture. Not authoritative preserve data; do not use for navigation.',
          pillar: null,
          source: 'Repository synthetic demo fixtures v1',
          isDemo: true,
          isPublic: true,
        };
        await tx
          .insert(gisLayer)
          .values(metadata)
          .onConflictDoUpdate({ target: gisLayer.layerId, set: metadata });
        for (const feature of layer.features) {
          const properties = {
            name: feature.name,
            isDemo: true,
            ...('surface_type' in feature ? { surface_type: feature.surface_type } : {}),
          };
          await tx.execute(sql`
          INSERT INTO gis_feature (feature_id, layer_id, geometry, properties)
          VALUES (${feature.id}, ${layer.layerId}, ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(feature.geometry)}), 4326), ${JSON.stringify(properties)}::jsonb)
          ON CONFLICT (feature_id) DO UPDATE SET layer_id = EXCLUDED.layer_id, geometry = EXCLUDED.geometry, properties = EXCLUDED.properties
        `);
        }
      }
    }),
  );
}
