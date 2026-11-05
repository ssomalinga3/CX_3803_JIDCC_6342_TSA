import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { visibleGis } from '@/data/layer-visibility';
import { usePublicGis } from '@/hooks/use-public-gis';

function useMapGisState() {
  const gis = usePublicGis(process.env.EXPO_PUBLIC_API_URL);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const snapshot = gis.snapshot;
  const visibleSnapshot = useMemo(
    () => (snapshot ? visibleGis(snapshot, hidden) : undefined),
    [snapshot, hidden],
  );
  return {
    gis,
    hidden,
    visibleSnapshot,
    applyHidden: (ids: ReadonlySet<string>) => {
      if (!snapshot) return;
      // Ignore stale/private/unknown IDs; choices are scoped to the current public catalog.
      setHidden(
        new Set(
          snapshot.layers.filter((layer) => ids.has(layer.layerId)).map((layer) => layer.layerId),
        ),
      );
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
