import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { visibleGis } from '@/data/layer-visibility';
import {
  defaultLayerPreset,
  hiddenWithOverrides,
  visibilityOverrides,
  type LayerPreset,
} from '@/data/layer-presets';
import { terrainKeys, visibleTerrainKeys, type TerrainKey } from '@/data/terrain';
import { usePublicGis } from '@/hooks/use-public-gis';

function useMapGisState() {
  const gis = usePublicGis(process.env.EXPO_PUBLIC_API_URL);
  const [choices, setChoices] = useState<{
    preset: LayerPreset;
    overrides: ReadonlyMap<string, boolean>;
    terrainSource: TerrainKey;
    terrainEnabled?: boolean;
  }>(() => ({ preset: defaultLayerPreset, overrides: new Map(), terrainSource: 'usgs' }));
  const snapshot = gis.snapshot;
  const availableTerrain = useMemo(() => visibleTerrainKeys(snapshot), [snapshot]);
  const terrainSource = availableTerrain.includes(choices.terrainSource)
    ? choices.terrainSource
    : (availableTerrain[0] ?? choices.terrainSource);
  const hidden = useMemo(() => {
    const result = new Set(hiddenWithOverrides(snapshot?.layers ?? [], choices.preset, choices.overrides));
    const enabled = choices.terrainEnabled ?? choices.preset !== 'visitor';
    for (const key of availableTerrain) {
      if (enabled && key === terrainSource) result.delete(`cascade-terrain-${key}`);
      else result.add(`cascade-terrain-${key}`);
    }
    return result;
  }, [snapshot, choices, availableTerrain, terrainSource]);
  const visibleSnapshot = useMemo(
    () => (snapshot ? visibleGis(snapshot, hidden) : undefined),
    [snapshot, hidden],
  );
  const applyChoices = (preset: LayerPreset, ids: ReadonlySet<string>, source?: TerrainKey) => {
    if (!snapshot) return;
    // Terrain is one display choice; keep its source/enabled state across catalog replacement.
    const nonTerrainLayers = snapshot.layers.filter(
      (layer) => !terrainKeys.some((key) => layer.layerId === `cascade-terrain-${key}`),
    );
    const selectedSource = availableTerrain.find((key) => !ids.has(`cascade-terrain-${key}`));
    setChoices((previous) => ({
      preset,
      overrides: visibilityOverrides(nonTerrainLayers, preset, ids),
      terrainSource: source ?? selectedSource ?? previous.terrainSource,
      terrainEnabled: availableTerrain.length
        ? Boolean(selectedSource)
        : preset === previous.preset ? previous.terrainEnabled : undefined,
    }));
  };
  return {
    gis,
    hidden,
    terrainSource,
    preset: choices.preset,
    visibleSnapshot,
    applyChoices,
    applyHidden: (ids: ReadonlySet<string>, source?: TerrainKey) => applyChoices(choices.preset, ids, source),
  };
}

const MapGisContext = createContext<ReturnType<typeof useMapGisState> | null>(null);
export function MapGisProvider({ children }: { children: ReactNode }) {
  const value = useMapGisState();
  return <MapGisContext.Provider value={value}>{children}</MapGisContext.Provider>;
}
export function useMapGis() {
  const value = useContext(MapGisContext);
  if (!value) throw new Error('MapGisProvider is required');
  return value;
}
