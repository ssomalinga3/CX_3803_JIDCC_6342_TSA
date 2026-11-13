import type { TerrainKey } from '@/data/terrain';

/** Bottom to top, above the basemap. Keep these layers mounted even with empty GIS. */
export const gisLayerOrder = [
  'gis-terrain-supplied-anchor',
  'gis-terrain-usgs-anchor',
  'gis-elevation-bands',
  'gis-boundary-fill',
  'gis-natural-areas',
  'gis-elevation-lines',
  'gis-water',
  'gis-roads',
  'gis-buildings',
  'gis-context-lines',
  'gis-boundary-outline',
  'gis-signal-samples',
  'gis-trail-casing',
  'gis-trails',
  'gis-unnamed-connections',
  'gis-landmarks',
  'gis-elevation-labels',
  'gis-trail-names',
  'gis-landmark-names',
] as const;

export function gisLayerProps(id: (typeof gisLayerOrder)[number]) {
  return { id, afterId: gisLayerOrder[gisLayerOrder.indexOf(id) - 1] };
}

/** Permanent empty slots make raster order independent of source mount/toggle timing. */
export function terrainLayerProps(key: TerrainKey) {
  return {
    id: `terrain-${key}-relief`,
    beforeId: key === 'supplied' ? 'gis-terrain-usgs-anchor' : 'gis-elevation-bands',
  };
}

export const deviceLocationLayerProps = {
  id: 'device-location-dot',
  afterId: gisLayerOrder[gisLayerOrder.length - 1],
};
