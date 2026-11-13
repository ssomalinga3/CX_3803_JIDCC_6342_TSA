import type { FeatureCollection } from '../modules/gis/types.js';
import { replaceLayers, type ImportLayerSpec } from './gis-import.js';
import { officialTrailLayer, readOfficialTrails } from './official-trails.js';
import { pdfMapLayers, pdfMapReplacements, readPdfMap } from './pdf-map.js';
import { terrainLayers, terrainReplacements, readTerrainMap } from './terrain-map.js';
import { signalLayer, readSignalMap } from './signal-map.js';

export const sourceMapUrl = 'https://www.google.com/maps/d/viewer?mid=1Q5BTcAcUwxp9Y320UwsszoCLO0k';
export const sourceMapLayers: readonly ImportLayerSpec[] = [
  officialTrailLayer,
  ...pdfMapLayers,
  ...terrainLayers,
  signalLayer,
];

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

/** Replace all selected source layers atomically; unrelated and demo data stay intact. */
export async function importSourceMap(connectionString: string, value: unknown): Promise<void> {
  validateSourceMap(value); // Archive validation only; legacy values cannot downgrade selected data.
  await replaceLayers(connectionString, 2, [
    { layer: officialTrailLayer, collection: readOfficialTrails() },
    ...pdfMapReplacements(readPdfMap()),
    ...terrainReplacements(readTerrainMap()),
    { layer: signalLayer, collection: readSignalMap() },
  ]);
}
