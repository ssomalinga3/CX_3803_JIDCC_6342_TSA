import { asc, eq, sql } from 'drizzle-orm';
import { withDatabase } from '../../db/client.js';
import { gisLayer } from '../../db/schema.js';
import type { Geometry, LayersRepository } from './types.js';

// Hyperdrive connectionString must be read during a request, never at Worker startup.
export function createLayersRepository(connectionString: () => string): LayersRepository {
  return {
    listPublicLayers: () =>
      withDatabase(connectionString(), async (db) => {
        const rows = await db
          .select({
            layerId: gisLayer.layerId,
            name: gisLayer.name,
            description: gisLayer.description,
            layerType: gisLayer.layerType,
            pillar: gisLayer.pillar,
            source: gisLayer.source,
            isDemo: gisLayer.isDemo,
          })
          .from(gisLayer)
          .where(eq(gisLayer.isPublic, true))
          .orderBy(asc(gisLayer.layerId));
        return {
          layers: rows.map((layer) => ({
            ...layer,
            featuresUrl: `/api/v1/layers/${encodeURIComponent(layer.layerId)}/features`,
          })),
        };
      }),
    getPublicLayerFeatures: (layerId, bbox) =>
      withDatabase(connectionString(), async (db) => {
        // One statement checks visibility and reads features under the same snapshot.
        // LEFT JOIN distinguishes a public empty layer from an unknown/private layer.
        const viewport = bbox
          ? sql`AND ST_Intersects(f.geometry, ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326))`
          : sql``;
        const result = await db.execute<{
          feature_id: string | null;
          geometry: Geometry | null;
          properties: Record<string, unknown> | null;
        }>(sql`
        SELECT f.feature_id, ST_AsGeoJSON(f.geometry)::jsonb AS geometry, f.properties
        FROM gis_layer l LEFT JOIN gis_feature f ON f.layer_id = l.layer_id ${viewport}
        WHERE l.layer_id = ${layerId} AND l.is_public = true
        ORDER BY f.feature_id
      `);
        if (result.rows.length === 0) return null;
        return {
          type: 'FeatureCollection',
          features: result.rows.flatMap((row) =>
            row.feature_id !== null && row.geometry !== null && row.properties !== null
              ? [
                  {
                    type: 'Feature' as const,
                    id: row.feature_id,
                    geometry: row.geometry,
                    properties: row.properties,
                  },
                ]
              : [],
          ),
        };
      }),
  };
}
