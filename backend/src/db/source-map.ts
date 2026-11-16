import type { FeatureCollection } from '../modules/gis/types.js';
import { replaceLayers, type ImportLayerSpec } from './gis-import.js';
import { officialTrailLayer, readOfficialTrails } from './official-trails.js';

export const sourceMapUrl = 'https://www.google.com/maps/d/viewer?mid=1Q5BTcAcUwxp9Y320UwsszoCLO0k';
const sourceMapDescription =
  'User-supplied Google My Maps landmarks, retrieved 2026-11-04. Preserved until reconciliation with the supplied PDF map.';
export const sourceMapLayers: readonly ImportLayerSpec[] = [
  officialTrailLayer,
  {
    layerId: 'cascade-map-landmarks',
    name: 'Cascade Springs landmarks (source map)',
    layerType: 'landmark',
    geometryType: 'Point',
    description: sourceMapDescription,
    source: sourceMapUrl,
    isDemo: false,
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
  const source = validateSourceMap(value);
  // The legacy command deliberately selects the supplied snapshot. It must never
  // restore the KML's approximate trail sections, even on a fresh database.
  const trails = readOfficialTrails();
  const landmarks: FeatureCollection = {
    type: 'FeatureCollection',
    features: source.features.filter((f) => f.geometry.type === 'Point'),
  };
  if (landmarks.features.length !== 8)
    throw new Error('Expected the eight preserved source landmarks');
  await replaceLayers(connectionString, 2, [
    { layer: sourceMapLayers[0]!, collection: trails },
    { layer: sourceMapLayers[1]!, collection: landmarks },
  ]);
}
