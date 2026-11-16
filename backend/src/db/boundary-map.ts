import type { FeatureCollection } from '../modules/gis/types.js';
import { importPdfMap, pdfMapLayers, readPdfMap } from './pdf-map.js';

// Retain legacy validation for archived inputs; publication always selects the PDF.
export const boundaryMapLayers = pdfMapLayers.filter((layer) => layer.layerType === 'boundary');

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

/** Legacy entry point selects all PDF context layers; it cannot restore the guessed boundary. */
export async function importBoundaryMap(connectionString: string, value: unknown): Promise<void> {
  validateBoundaryMap(value);
  await importPdfMap(connectionString, readPdfMap());
}
