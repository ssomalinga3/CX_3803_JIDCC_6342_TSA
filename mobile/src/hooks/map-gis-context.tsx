import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { visibleGis } from '@/data/layer-visibility';
import { terrainKeys, visibleTerrainKeys, type TerrainKey } from '@/data/terrain';
import { usePublicGis } from '@/hooks/use-public-gis';

function useMapGisState() {
  const gis = usePublicGis(process.env.EXPO_PUBLIC_API_URL);
  const [choices, setChoices] = useState<{
    hidden: ReadonlySet<string>;
    terrainSource: TerrainKey;
    terrainEnabled: boolean;
  }>(() => ({ hidden: new Set(), terrainSource: 'usgs', terrainEnabled: true }));
  const snapshot = gis.snapshot;
  const availableTerrain = useMemo(() => visibleTerrainKeys(snapshot), [snapshot]);
  const terrainSource = availableTerrain.includes(choices.terrainSource)
    ? choices.terrainSource
    : (availableTerrain[0] ?? choices.terrainSource);
  // Elevation is one display choice backed by two separately attributed API layers.
  const hidden = useMemo(() => {
    const result = new Set(choices.hidden);
    for (const key of availableTerrain) {
      if (!choices.terrainEnabled || key !== terrainSource) result.add(`cascade-terrain-${key}`);
    }
    return result;
  }, [choices, availableTerrain, terrainSource]);
  const visibleSnapshot = useMemo(
    () => (snapshot ? visibleGis(snapshot, hidden) : undefined),
    [snapshot, hidden],
  );
  return {
    gis,
    hidden,
    terrainSource,
    visibleSnapshot,
    applyHidden: (ids: ReadonlySet<string>, source?: TerrainKey) => {
      if (!snapshot) return;
      // Ignore stale/private/unknown IDs; choices are scoped to the current public catalog.
      setChoices((previous) => ({
        hidden: new Set(
          snapshot.layers
            .filter(
              (layer) =>
                ids.has(layer.layerId) &&
                !terrainKeys.some((key) => layer.layerId === `cascade-terrain-${key}`),
            )
            .map((layer) => layer.layerId),
        ),
        terrainSource: source ?? previous.terrainSource,
        terrainEnabled: availableTerrain.length
          ? availableTerrain.some((key) => !ids.has(`cascade-terrain-${key}`))
          : previous.terrainEnabled,
      }));
    },
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
