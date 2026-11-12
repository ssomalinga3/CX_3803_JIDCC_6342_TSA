import type { FeatureCollection } from '../modules/gis/types.js';
import { replaceLayers, type ImportLayerSpec } from './gis-import.js';

// The hand-drawn boundary remains approximate until the PDF slice replaces it.
// Supplied trail geometry does not upgrade this polygon's accuracy.
export const boundaryMapSource = 'Hand-drawn estimate by the project team';
export const boundaryMapLayers: readonly ImportLayerSpec[] = [
  {
    layerId: 'cascade-map-boundary',
    name: 'Cascade Springs boundary (approximate)',
    layerType: 'boundary',
    geometryType: 'Polygon',
    description:
      'Hand-drawn approximate preserve outline supplied by the project team. Not surveyed, field-verified, or approved for navigation or property determinations. Awaiting supplied PDF boundary extraction.',
    source: boundaryMapSource,
    isDemo: false,
  },
] as const;

/** Validate the dataset-specific ingestion contract before opening a transaction. */
export function validateBoundaryMap(value: unknown): FeatureCollection {
  const collection = value as FeatureCollection | null;
  if (
    !collection ||
    collection.type !== 'FeatureCollection' ||
    !Array.isArray(collection.features) ||
    !collection.features.length
  )
    throw new Error('Invalid boundary collection');
  const ids = new Set<string>();
  for (const feature of collection.features) {
    if (
      !feature ||
      feature.type !== 'Feature' ||
      typeof feature.id !== 'string' ||
      !/^cascade-boundary-[a-f0-9]{16}$/.test(feature.id) ||
      ids.has(feature.id) ||
      !feature.properties ||
      Array.isArray(feature.properties) ||
      typeof feature.properties.name !== 'string' ||
      !feature.properties.name ||
      feature.properties.feature_kind !== 'boundary' ||
      feature.properties.boundary_kind !== 'preserve' ||
      feature.properties.name_assignment !== 'approximate'
    )
      throw new Error('Invalid boundary feature');
    ids.add(feature.id);
    const geometry = feature.geometry;
    if (!geometry || geometry.type !== 'Polygon') throw new Error('Unsupported boundary geometry');
    const rings = geometry.coordinates;
    if (!Array.isArray(rings) || !rings.length) throw new Error('Invalid boundary coordinates');
    for (const ring of rings) {
      if (
        !Array.isArray(ring) ||
        ring.length < 4 ||
        ring.some(
          (position) =>
            !Array.isArray(position) ||
            position.length !== 2 ||
            !position.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
            Math.abs(position[0]!) > 180 ||
            Math.abs(position[1]!) > 90,
        ) ||
        ring[0]![0] !== ring[ring.length - 1]![0] ||
        ring[0]![1] !== ring[ring.length - 1]![1]
      )
        throw new Error('Invalid boundary ring');
    }
  }
  return collection;
}

/** Replace only this source's boundary layer atomically; unrelated data stays intact. */
export async function importBoundaryMap(connectionString: string, value: unknown): Promise<void> {
  const collection = validateBoundaryMap(value);
  await replaceLayers(connectionString, 3, [{ layer: boundaryMapLayers[0]!, collection }]);
}
