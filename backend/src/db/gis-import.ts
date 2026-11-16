import { sql } from 'drizzle-orm';
import type { FeatureCollection } from '../modules/gis/types.js';
import { withDatabase } from './client.js';
import { gisLayer } from './schema.js';

/** Metadata and expected geometry for one explicitly selected feature collection. */
export interface ImportLayerSpec {
  layerId: string;
  name: string;
  layerType: string;
  geometryType: FeatureCollection['features'][number]['geometry']['type'];
  description: string;
  source: string;
  /** Sourced (false) vs. synthetic (true). Imports publish sourced data. */
  isDemo?: boolean;
  pillar?: string | null;
}

/**
 * Shared import mechanics for the file-backed GIS datasets (source map, boundary,
 * and any future dataset). Serializes concurrent imports on a per-dataset advisory
 * lock, then transactionally replaces only the given layers' features: upsert layer
 * metadata, delete stale features, and insert the explicitly selected collection. Any invalid
 * geometry rolls back the whole replacement; unrelated layers are untouched.
 *
 * Callers own validation and the layer specs; this owns the transaction shape so the
 * datasets stay symmetric by construction rather than by copy-paste.
 */
export async function replaceLayers(
  connectionString: string,
  lockKey: number,
  replacements: readonly { layer: ImportLayerSpec; collection: FeatureCollection }[],
): Promise<void> {
  const layerIds = new Set<string>();
  const featureIds = new Set<string>();
  for (const { layer, collection } of replacements) {
    if (layerIds.has(layer.layerId)) throw new Error('Duplicate replacement layer');
    layerIds.add(layer.layerId);
    for (const feature of collection.features) {
      if (featureIds.has(feature.id) || feature.geometry.type !== layer.geometryType)
        throw new Error('Duplicate layer assignment or unsupported replacement geometry');
      featureIds.add(feature.id);
    }
  }
  await withDatabase(connectionString, (db) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6342, ${lockKey})`);
      for (const { layer, collection } of replacements) {
        const metadata = {
          layerId: layer.layerId,
          name: layer.name,
          layerType: layer.layerType,
          description: layer.description,
          pillar: layer.pillar ?? null,
          source: layer.source,
          isDemo: layer.isDemo ?? false,
          isPublic: true,
        };
        await tx
          .insert(gisLayer)
          .values(metadata)
          .onConflictDoUpdate({ target: gisLayer.layerId, set: metadata });
        await tx.execute(sql`DELETE FROM gis_feature WHERE layer_id = ${layer.layerId}`);
        for (const feature of collection.features) {
          await tx.execute(sql`
          INSERT INTO gis_feature (feature_id, layer_id, geometry, properties)
          VALUES (${feature.id}, ${layer.layerId}, ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(feature.geometry)}), 4326), ${JSON.stringify(feature.properties)}::jsonb)
        `);
        }
      }
    }),
  );
}
