import type { GisSnapshot } from '@/data/gis';

// A display-only subset: retain original IDs/provenance and never fetch on toggle.
export function visibleGis(snapshot: GisSnapshot, hidden: ReadonlySet<string>): GisSnapshot {
  if (!snapshot.layers.some((layer) => hidden.has(layer.layerId))) return snapshot;
  const layers = snapshot.layers.filter((layer) => !hidden.has(layer.layerId));
  const visibleIds = new Set(layers.map((layer) => layer.layerId));
  const features = snapshot.collection.features.filter((feature) => {
    const layer = snapshot.featureLayers.get(feature.id);
    return layer !== undefined && visibleIds.has(layer.layerId);
  });
  return {
    ...snapshot,
    layers,
    collection: { type: 'FeatureCollection', features },
    featureLayers: new Map(
      features.map((feature) => [feature.id, snapshot.featureLayers.get(feature.id)!]),
    ),
    isDemo:
      layers.some((layer) => layer.isDemo) ||
      features.some((feature) => feature.properties.isDemo === true),
  };
}
