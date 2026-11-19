/**
 * Single source of truth for user-facing disclaimers and caveats.
 *
 * Per the UI specification, disclaimers must not be rendered inline across map,
 * reporting, or other feature UI. They are consolidated here and surfaced only
 * in the Disclaimers tab so the wording stays consistent and reviewable.
 */

export type Disclaimer = {
  id: string;
  title: string;
  body: string;
};

export const disclaimers: readonly Disclaimer[] = [
  {
    id: 'terrain-3d',
    title: '3D terrain',
    body: 'The 3D map uses a separate preserved USGS 3DEP subset covering three times the original width and height, with NAVD88 metre heights at true vertical scale. Elevation is resampled for a bounded display; its export date is not an acquisition date. Selected basemap tiles are draped over the ground, with elevation-derived hillshade to reveal slopes. Tile imagery, vegetation and conditions are not live. Trail lines follow the terrain surface and are not measured ascent. The bundled terrain can work with saved trails offline; online tiles need connectivity and fall back to terrain when unavailable. First use needs a successful GIS load. This is an approximate orientation model, not a survey or safety assessment.',
  },
  {
    id: 'basemaps',
    title: 'Base map sources',
    body: 'OpenFreeMap uses OpenMapTiles and OpenStreetMap data. USGS National Map sources provide topography, aerial photography and shaded relief; they are separate from the supplied preserve GIS and the Elevation overlay. Imagery is not live satellite coverage: service metadata lists mainly NAIP aerial photography from 2017–2021 for the continental US, refreshed June 2024; the exact preserve acquisition date is unverified. Topographic and relief service refresh dates are September 2026 and September 2025, not local acquisition dates. Close zoom enlarges existing USGS detail rather than adding resolution. Roads and trails drawn by providers are background context, not approved preserve routes. Sources can differ in age, alignment and availability. Online tile requests disclose the viewed area to the chosen provider; GPS is not separately uploaded. These choices do not download an offline map.',
  },
  {
    id: 'cell-signal',
    title: 'Cell-signal observations',
    body: 'Colored dots are 677 recoverable samples from the supplied Cell Signal Strength screenshot, registered approximately to map controls. The five labels reproduce its legend classes; units, exact readings, carrier, device and survey date are unknown. Withheld basemap controls disagree by up to about 28 m, and annotation symbols by about 31 m; these are cartographic comparisons, not GPS or survey accuracy. The northern boundary differs between maps, and some samples lie beyond the control area. Overlapping, obscured or ambiguous dots are omitted. Positions and classes are uncertain. These observations do not show current connectivity or guarantee service and are not a continuous coverage map. The app does not collect cellular measurements.',
  },
  {
    id: 'supplied-terrain',
    title: 'Elevation · supplied DTM',
    body: 'The supplied csnp_dtm_2015 grid uses NAVD88 heights in US survey feet (ftUS). The filename suggests 2015; acquisition date and horizontal datum are unconfirmed. Its GRS80 projection is displayed with a no-datum-shift assumption. Boundary registration and terrain comparison support approximate orientation, not survey accuracy. Relief is regenerated from the grid; the original hillshade is retained as alignment evidence. Bands span 20 ftUS and are resampled and simplified. They are not measured trail ascent or current conditions.',
  },
  {
    id: 'national-terrain',
    title: 'Elevation · USGS 3DEP',
    body: 'USGS National Map 3DEP provides this separate public national elevation option. A fixed service subset is reprojected and resampled for display; its export date is not its acquisition date. Source heights are NAVD88 meters, converted to US survey feet (ftUS) for 20 ftUS bands. The service combines resolutions and source vintages; small terrain features may be omitted. Differences from the supplied DTM do not establish terrain change or either dataset’s accuracy. Toggle the two elevation sources separately to compare; neither is a land survey or navigation guarantee.',
  },
  {
    id: 'trail-names',
    title: 'Supplied trail data',
    body: 'Trails use the supplied GIS export from April 9, 2026. One segment has no source name, and most segments have no supplied difficulty. Colors follow the app’s park-sign palette; source colors may differ. Notes describe source observations, not live alerts. Check park signs and current conditions on site.',
  },
  {
    id: 'preserve-boundary',
    title: 'Supplied map context and landmarks',
    body: 'Boundary, water, natural areas, roads, buildings and landmark symbols are recovered from the supplied April 2026 map. Rounded geographic anchors and cartographic symbol placement limit positioning. The boundary is not a property survey. My Maps annotations retain their original positions; the Spring annotation has not been matched to the PDF’s Frog Pond / Spring. These may describe the same place. Route notes are historical source observations, not current navigation guidance.',
  },
  {
    id: 'not-for-navigation',
    title: 'Not for navigation',
    body: 'Map shapes, including any synthetic or demo geometry, are for orientation only. Do not rely on them for navigation, safety, or emergency routing.',
  },
  {
    id: 'location-privacy',
    title: 'Location stays on your device',
    body: 'Your map location stays on this device and is not uploaded. Offline map downloads are not available yet.',
  },
] as const;
