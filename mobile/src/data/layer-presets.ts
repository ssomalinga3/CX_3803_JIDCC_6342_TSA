import type { GisSnapshot } from '@/data/gis';

export const layerPresets = [
  { id: 'visitor', label: 'Visitor', description: 'Trails, preserve boundary and landmarks.' },
  {
    id: 'staff',
    label: 'Staff',
    description: 'Basic layers plus park context and elevation.',
  },
  {
    id: 'researcher',
    label: 'Researcher',
    description: 'Staff layers plus cell-signal source observations.',
  },
] as const;
export type LayerPreset = (typeof layerPresets)[number]['id'];
export const defaultLayerPreset: LayerPreset = 'visitor';
type Layers = GisSnapshot['layers'];
const basics = new Set(['trail', 'boundary', 'landmark']);
const context = new Set(['water', 'road', 'building', 'natural_area']);

/** Public display defaults only. Unknown content remains available through manual switches. */
export function hiddenForPreset(layers: Layers, preset: LayerPreset): ReadonlySet<string> {
  const terrain = layers.some((l) => l.layerId === 'cascade-terrain-usgs')
    ? 'cascade-terrain-usgs'
    : 'cascade-terrain-supplied';
  return new Set(
    layers
      .filter((layer) => {
        if (basics.has(layer.layerType)) return false;
        if (preset === 'visitor') return true;
        if (context.has(layer.layerType)) return false;
        if (layer.layerType === 'terrain' && layer.layerId === terrain) return false;
        return !(preset === 'researcher' && layer.layerType === 'cell_signal');
      })
      .map((layer) => layer.layerId),
  );
}

export function hiddenWithOverrides(
  layers: Layers,
  preset: LayerPreset,
  overrides: ReadonlyMap<string, boolean>,
): ReadonlySet<string> {
  const hidden = new Set(hiddenForPreset(layers, preset));
  for (const layer of layers) {
    if (!overrides.has(layer.layerId)) continue;
    if (overrides.get(layer.layerId)) hidden.delete(layer.layerId);
    else hidden.add(layer.layerId);
  }
  return hidden;
}

/** Store only explicit differences, so later catalog additions follow the selected preset. */
export function visibilityOverrides(
  layers: Layers,
  preset: LayerPreset,
  hidden: ReadonlySet<string>,
): ReadonlyMap<string, boolean> {
  const defaults = hiddenForPreset(layers, preset);
  return new Map(
    layers
      .filter((l) => defaults.has(l.layerId) !== hidden.has(l.layerId))
      .map((l) => [l.layerId, !hidden.has(l.layerId)]),
  );
}

export function isCustomized(
  layers: Layers,
  preset: LayerPreset,
  hidden: ReadonlySet<string>,
): boolean {
  const defaults = hiddenForPreset(layers, preset);
  return layers.some((l) => defaults.has(l.layerId) !== hidden.has(l.layerId));
}
