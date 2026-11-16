import type { StyleSpecification } from '@maplibre/maplibre-react-native';

import { OFFLINE_STYLE } from '@/data/offline-basemap-config';

export type Basemap = {
  id: string;
  provider: 'OpenFreeMap' | 'USGS' | 'Offline prototype';
  name: string;
  description: string;
  style: string | StyleSpecification;
  attribution: string;
  nativeMaxZoom: number;
};

export const basemapProviderDescriptions: Record<Basemap['provider'], string> = {
  OpenFreeMap:
    'Community-maintained OpenStreetMap data, with streets, buildings, parks and place names.',
  USGS: 'Published maps from the U.S. Geological Survey and partners, including aerial photos, contour maps and terrain shading.',
  'Offline prototype': 'The preserve map used by the existing offline download option.',
};

export const DEFAULT_BASEMAP = 'openfreemap-liberty';
export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const ofmAttribution = 'OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors';
const sourceCredits: Record<string, string> = {
  USGSImageryOnly: 'USDA, USGS The National Map: Orthoimagery. Data refreshed June, 2024.v1.2',
  USGSTopo:
    'USGS The National Map: National Boundaries Dataset, 3DEP Elevation Program, Geographic Names Information System, National Hydrography Dataset, National Land Cover Database, National Structures Dataset, and National Transportation Dataset; USGS Global Ecosystems; U.S. Census Bureau TIGER/Line data; USFS Road data; Natural Earth Data; U.S. Department of State HIU; NOAA National Centers for Environmental Information. Data refreshed September 4, 2026-v1.2',
  USGSImageryTopo:
    'USGS The National Map: Orthoimagery and US Topo. Data refreshed April, 2026.v1.2.',
  USGSShadedReliefOnly:
    'USGS The National Map: 3D Elevation Program. USGS Earth Resources Observation & Science (EROS) Center: GMTED2010. Data refreshed September, 2025.v1.1.',
};
const usgsRoot = 'https://basemap.nationalmap.gov/arcgis/rest/services';

function raster(
  id: string,
  name: string,
  description: string,
  service: string,
  attribution: string,
): Basemap {
  return {
    id: `usgs-${id}`,
    provider: 'USGS',
    name,
    description,
    attribution,
    // The cache advertises more levels, but useful source detail ends around z16.
    // Overzoom that detail instead of requesting empty high-zoom tiles.
    nativeMaxZoom: 16,
    style: {
      version: 8,
      glyphs: GLYPHS,
      sources: {
        basemap: {
          type: 'raster',
          tiles: [`${usgsRoot}/${service}/MapServer/tile/{z}/{y}/{x}`],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 16,
          attribution: sourceCredits[service],
        },
      },
      layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
    },
  };
}

// Only sources cleared for this build belong here. Public keys alone do not
// establish free-plan eligibility or a provider-enforced zero-spend cap.
export const basemaps: readonly Basemap[] = [
  ...[
    ['liberty', 'Standard', 'Street map with roads, buildings, parks and place names.'],
    ['positron', 'Light', 'Muted colors give preserve trails and overlays more visual emphasis.'],
    ['bright', 'Bright', 'Colorful streets and land cover with clear road and place labels.'],
    ['dark', 'Dark', 'Dark styling contrasts with preserve trails and landmarks.'],
    ['fiord', 'Fiord', 'Cool blue-gray styling with subdued roads and labels.'],
  ].map(([slug, name, description]): Basemap => ({
    id: `openfreemap-${slug}`,
    provider: 'OpenFreeMap',
    name,
    description,
    style: `https://tiles.openfreemap.org/styles/${slug}`,
    attribution: ofmAttribution,
    nativeMaxZoom: 14,
  })),
  raster(
    'aerial',
    'Aerial',
    'USDA/USGS aerial photography showing tree cover, clearings and nearby development.',
    'USGSImageryOnly',
    'USDA · USGS The National Map: Orthoimagery',
  ),
  raster(
    'topographic',
    'Topographic',
    'Contour lines, streams, roads and geographic names from the USGS National Map.',
    'USGSTopo',
    'USGS The National Map · USGS partners',
  ),
  raster(
    'aerial-topographic',
    'Aerial + Topographic',
    'Aerial photography with contours, roads and place labels layered on top.',
    'USGSImageryTopo',
    'USGS The National Map: Orthoimagery and US Topo',
  ),
  raster(
    'shaded-relief',
    'Shaded Relief',
    'Shading from elevation data reveals hills, ridges and valleys.',
    'USGSShadedReliefOnly',
    'USGS The National Map: 3DEP · USGS EROS: GMTED2010',
  ),
  ...(OFFLINE_STYLE
    ? [
        {
          id: 'offline-prototype',
          provider: 'Offline prototype' as const,
          name: 'Configured offline map',
          description: 'The map used by the preserve’s offline download option.',
          style: OFFLINE_STYLE,
          attribution: 'Configured offline map · See map attribution',
          nativeMaxZoom: 16,
        },
      ]
    : []),
];

export function getBasemap(id: string): Basemap {
  return basemaps.find((entry) => entry.id === id) ?? basemaps[0];
}

// Removing remote sources stops the failed provider's tile requests. GIS and
// the native camera stay mounted, and a deliberate Retry restores the source.
export const unavailableBasemap: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS,
  sources: {},
  layers: [
    { id: 'unavailable-background', type: 'background', paint: { 'background-color': '#e7e7e7' } },
  ],
};
