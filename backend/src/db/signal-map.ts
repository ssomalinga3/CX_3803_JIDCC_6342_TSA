import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import type { FeatureCollection } from '../modules/gis/types.js';
import { replaceLayers, type ImportLayerSpec } from './gis-import.js';

const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
export const signalContract = read('../../../data/cascade-springs-gis/signal-contract.json') as {
  layer_id: string;
  source_dataset: string;
  source_file: string;
  source_sha256: string;
  extraction_version: number;
  feature_count: number;
  image_size: number[];
  properties: string[];
  classes: { label: string; recovered_count: number }[];
};
export const signalLayer: ImportLayerSpec = {
  layerId: signalContract.layer_id,
  name: 'Cell-signal observations',
  layerType: 'cell_signal',
  geometryType: 'Point',
  description: 'Recovered signal classes from the supplied screenshot.',
  source: 'Supplied Cell Signal Strength.png; recovered observation classes',
  isDemo: false,
};
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Reject incomplete recovery, invented measurements and unsupported geometry before connecting. */
export function validateSignalMap(value: unknown): FeatureCollection {
  const c = signalContract;
  if (
    !object(value) ||
    value.type !== 'FeatureCollection' ||
    !Array.isArray(value.features) ||
    value.features.length !== c.feature_count
  )
    throw new Error('Invalid signal collection');
  const ids = new Set<string>();
  const counts = new Map(c.classes.map((cl) => [cl.label, 0]));
  for (const f of value.features) {
    if (
      !object(f) ||
      f.type !== 'Feature' ||
      typeof f.id !== 'string' ||
      ids.has(f.id) ||
      !object(f.properties) ||
      !object(f.geometry)
    )
      throw new Error('Invalid signal feature');
    ids.add(f.id);
    const p = f.properties;
    const pixel = p.source_pixel;
    if (
      p.source_dataset !== c.source_dataset ||
      p.source_file !== c.source_file ||
      p.source_sha256 !== c.source_sha256 ||
      p.extraction_version !== c.extraction_version ||
      p.isDemo !== false ||
      typeof p.signal_class !== 'string' ||
      !counts.has(p.signal_class) ||
      p.name !== `Cell-signal sample · ${p.signal_class}` ||
      typeof p.positioning !== 'string' ||
      !p.positioning ||
      Object.keys(p).some((key) => !c.properties.includes(key)) ||
      !Array.isArray(pixel) ||
      pixel.length !== 2 ||
      pixel.some(
        (n, i) =>
          typeof n !== 'number' ||
          !Number.isFinite(n) ||
          n < 0 ||
          n >= c.image_size[i]! ||
          !Number.isInteger(n * 2),
      ) ||
      f.id !==
        `csnp-signal-v1-${String(pixel[0] * 2).padStart(4, '0')}-${String(pixel[1] * 2).padStart(4, '0')}`
    )
      throw new Error('Invalid signal provenance or classification');
    counts.set(p.signal_class, counts.get(p.signal_class)! + 1);
    const position = f.geometry.coordinates;
    if (
      f.geometry.type !== 'Point' ||
      !Array.isArray(position) ||
      position.length !== 2 ||
      position.some((n) => typeof n !== 'number' || !Number.isFinite(n)) ||
      position[0] < -84.485 ||
      position[0] > -84.474 ||
      position[1] < 33.714 ||
      position[1] > 33.721
    )
      throw new Error('Invalid signal position');
  }
  if (c.classes.some((cl) => counts.get(cl.label) !== cl.recovered_count))
    throw new Error('Incomplete signal classes');
  return value as unknown as FeatureCollection;
}
export function readSignalMap(): FeatureCollection {
  return validateSignalMap(read('../../../data/cascade-springs-gis/signal.geojson'));
}
export async function importSignalMap(connectionString: string, value: unknown): Promise<void> {
  await replaceLayers(connectionString, 2, [
    { layer: signalLayer, collection: validateSignalMap(value) },
  ]);
}
