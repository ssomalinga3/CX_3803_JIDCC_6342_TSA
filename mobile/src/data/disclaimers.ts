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
