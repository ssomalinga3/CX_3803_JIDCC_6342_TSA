import { sql } from 'drizzle-orm';
import { withDatabase } from './client.js';
import { gisLayer } from './schema.js';

/** Synthetic demo boundary fixture. Not surveyed preserve data or navigation data.
 * The real approximate boundary is a separate validated import (boundary-map.ts). */
const fixtures = [
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
