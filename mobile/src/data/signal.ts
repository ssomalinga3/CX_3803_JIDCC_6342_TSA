import contract from '../../../data/cascade-springs-gis/signal-contract.json';
import type { GisSnapshot } from '@/data/gis';

export const signalClasses = contract.classes;
export const signalLayerId = contract.layer_id;
type Feature = GisSnapshot['collection']['features'][number];

/** Unknown/incomplete signal versions must use the visible GIS error/retry path. */
export function validateSignalFeatures(layers: GisSnapshot['layers'], features: Feature[]) {
  const layer = layers.find((l) => l.layerId === signalLayerId);
  const owned = features.filter((f) => f.id.startsWith(`${signalLayerId}/`));
  const ownedSet = new Set(owned);
  if (layer && (layer.layerType !== 'cell_signal' || owned.length !== contract.feature_count))
    throw new Error('Incomplete signal observations');
  const counts = new Map(signalClasses.map((c) => [c.label, 0]));
  for (const feature of features) {
    if (feature.properties.feature_kind !== 'signal_observation' && !ownedSet.has(feature))
      continue;
    const p = feature.properties;
    const pixel = p.source_pixel;
    if (
      !layer ||
      !ownedSet.has(feature) ||
      feature.geometry.type !== 'Point' ||
      feature.geometry.coordinates.length !== 2 ||
      feature.geometry.coordinates[0] < -84.485 ||
      feature.geometry.coordinates[0] > -84.474 ||
      feature.geometry.coordinates[1] < 33.714 ||
      feature.geometry.coordinates[1] > 33.721 ||
      p.feature_kind !== 'signal_observation' ||
      p.source_dataset !== contract.source_dataset ||
      p.source_file !== contract.source_file ||
      p.source_sha256 !== contract.source_sha256 ||
      p.extraction_version !== contract.extraction_version ||
      p.isDemo !== false ||
      typeof p.signal_class !== 'string' ||
      !counts.has(p.signal_class) ||
      p.name !== `Cell-signal sample · ${p.signal_class}` ||
      typeof p.positioning !== 'string' ||
      !p.positioning ||
      Object.keys(p).some((key) => !contract.properties.includes(key)) ||
      !Array.isArray(pixel) ||
      pixel.length !== 2 ||
      pixel.some(
        (n, i) =>
          typeof n !== 'number' ||
          !Number.isFinite(n) ||
          n < 0 ||
          n >= contract.image_size[i] ||
          !Number.isInteger(n * 2),
      ) ||
      feature.id !==
        `${signalLayerId}/csnp-signal-v1-${String(pixel[0] * 2).padStart(4, '0')}-${String(pixel[1] * 2).padStart(4, '0')}`
    )
      throw new Error('Invalid signal observations');
    counts.set(p.signal_class, counts.get(p.signal_class)! + 1);
  }
  if (layer && signalClasses.some((c) => counts.get(c.label) !== c.recovered_count))
    throw new Error('Incomplete signal classes');
}

export function hasSignal(snapshot: GisSnapshot | undefined): boolean {
  return (
    snapshot?.collection.features.some((f) => f.properties.feature_kind === 'signal_observation') ??
    false
  );
}
