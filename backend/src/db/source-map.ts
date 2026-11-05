import { sql } from 'drizzle-orm';
import type { FeatureCollection } from '../modules/gis/types.js';
import { withDatabase } from './client.js';
import { gisLayer } from './schema.js';
import { splitSourceMapTrails } from './source-map-trails.js';

export const sourceMapUrl = 'https://www.google.com/maps/d/viewer?mid=1Q5BTcAcUwxp9Y320UwsszoCLO0k';
export const sourceMapLayers = [
  {
    layerId: 'cascade-map-trails',
    name: 'Cascade Springs trails (approximate names)',
    layerType: 'trail',
    geometryType: 'LineString',
  },
  {
    layerId: 'cascade-map-landmarks',
    name: 'Cascade Springs landmarks (source map)',
    layerType: 'landmark',
    geometryType: 'Point',
  },
] as const;

/** Validate the dataset-specific ingestion contract before opening a transaction. */
export function validateSourceMap(value: unknown): FeatureCollection {
  const collection = value as FeatureCollection | null;
  if (
    !collection ||
    collection.type !== 'FeatureCollection' ||
    !Array.isArray(collection.features) ||
    !collection.features.length
  )
    throw new Error('Invalid source collection');
  const ids = new Set<string>();
  for (const feature of collection.features) {
    if (
      !feature ||
      feature.type !== 'Feature' ||
      typeof feature.id !== 'string' ||
      !/^cascade-map-[a-f0-9]{16}$/.test(feature.id) ||
      ids.has(feature.id) ||
      !feature.properties ||
      Array.isArray(feature.properties) ||
      typeof feature.properties.name !== 'string' ||
      !feature.properties.name ||
      typeof feature.properties.description_html !== 'string' ||
      typeof feature.properties.source_style_url !== 'string' ||
      feature.properties.source_url !== sourceMapUrl ||
      feature.properties.isDemo !== false
    )
      throw new Error('Invalid source feature');
    ids.add(feature.id);
    const geometry = feature.geometry;
    if (!geometry || !['Point', 'LineString'].includes(geometry.type))
      throw new Error('Unsupported source geometry');
    const positions =
      geometry.type === 'Point'
        ? [geometry.coordinates]
        : geometry.type === 'LineString'
          ? geometry.coordinates
          : [];
    if (
      !Array.isArray(positions) ||
      positions.length < (geometry.type === 'Point' ? 1 : 2) ||
      positions.some(
        (position) =>
          !Array.isArray(position) ||
          position.length !== 2 ||
          !position.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
          Math.abs(position[0]!) > 180 ||
          Math.abs(position[1]!) > 90,
      )
    )
      throw new Error('Invalid source coordinates');
  }
  return collection;
}

/** Replace only this source's two layers atomically; unrelated and demo data stay intact. */
export async function importSourceMap(connectionString: string, value: unknown): Promise<void> {
  const collection = splitSourceMapTrails(validateSourceMap(value));
  await withDatabase(connectionString, (db) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6342, 2)`);
      for (const layer of sourceMapLayers) {
        const metadata = {
          layerId: layer.layerId,
          name: layer.name,
          layerType: layer.layerType,
          description:
            'User-supplied Google My Maps snapshot, retrieved 2026-11-04. Trail names are approximate park-sign matches on partial source geometry. Not surveyed or approved for trail safety. No protective boundary supplied.',
          pillar: null,
          source: sourceMapUrl,
          isDemo: false,
          isPublic: true,
        };
        await tx
          .insert(gisLayer)
          .values(metadata)
          .onConflictDoUpdate({ target: gisLayer.layerId, set: metadata });
        await tx.execute(sql`DELETE FROM gis_feature WHERE layer_id = ${layer.layerId}`);
        for (const feature of collection.features.filter(
          (feature) => feature.geometry.type === layer.geometryType,
        )) {
          await tx.execute(sql`
          INSERT INTO gis_feature (feature_id, layer_id, geometry, properties)
          VALUES (${feature.id}, ${layer.layerId}, ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(feature.geometry)}), 4326), ${JSON.stringify(feature.properties)}::jsonb)
        `);
        }
      }
    }),
  );
}
