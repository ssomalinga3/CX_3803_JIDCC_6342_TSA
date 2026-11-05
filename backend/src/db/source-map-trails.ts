import { createHash } from 'node:crypto';
import type { FeatureCollection } from '../modules/gis/types.js';

// Inclusive, zero-based vertices in the retained KML route. See the review table
// in data/cascade-springs/README.md. These are approximate identity assignments,
// never new geometry, approved navigation routes, or complete trail lengths.
const sections = [
  { id: 'gateway-outbound', start: 0, end: 9, trail: 'gateway', name: 'Gateway Trail' },
  {
    id: 'creek',
    start: 9,
    end: 65,
    trail: 'turkeyfoot-utoy-creek',
    name: 'Turkeyfoot/Utoy Creek Trail',
  },
  { id: 'west', start: 65, end: 84, trail: 'west', name: 'West Trail' },
  { id: 'battle-ridge', start: 84, end: 92, trail: 'battle-ridge', name: 'Battle Ridge Trail' },
  { id: 'terrace', start: 92, end: 114, trail: 'terrace', name: 'Terrace Trail' },
  { id: 'southeast-connection', start: 114, end: 130, trail: null, name: null },
  { id: 'white-oak', start: 130, end: 146, trail: 'white-oak', name: 'White Oak Trail' },
  { id: 'springs', start: 146, end: 176, trail: 'springs', name: 'Springs Trail' },
  { id: 'spring-connection', start: 176, end: 182, trail: null, name: null },
  { id: 'gateway-return', start: 182, end: 190, trail: 'gateway', name: 'Gateway Trail' },
] as const;

const routeId = 'cascade-map-024c5c466a926108';
const geometryHash = '9b919a7340961434a4652385832319573749e7e639c759c0ff18b7dad78d0a45';

/** Derive display sections from the reviewed snapshot without modifying it. */
export function splitSourceMapTrails(collection: FeatureCollection): FeatureCollection {
  const route = collection.features.find((feature) => feature.id === routeId);
  if (
    route?.geometry.type !== 'LineString' ||
    createHash('sha256').update(JSON.stringify(route.geometry)).digest('hex') !== geometryHash
  ) {
    throw new Error('Source route changed; review trail-name sections before importing');
  }
  const coordinates = route.geometry.coordinates;
  return {
    type: 'FeatureCollection',
    features: collection.features.flatMap((feature) =>
      feature.id !== routeId
        ? [feature]
        : sections.map((section) => ({
            type: 'Feature' as const,
            id: `${routeId}-${section.id}`,
            geometry: {
              type: 'LineString' as const,
              coordinates: coordinates.slice(section.start, section.end + 1),
            },
            properties: {
              ...route.properties,
              name: section.name ?? 'Unnamed trail connection',
              ...(section.trail ? { feature_kind: 'trail', trail_id: section.trail } : {}),
              name_assignment: section.name ? 'approximate' : 'unassigned',
              ...(section.name
                ? { name_source: 'docs/design/references/cascade-springs-trail-network.png' }
                : {}),
              source_name: route.properties.name,
              source_feature_id: routeId,
              source_vertex_start: section.start,
              source_vertex_end: section.end,
            },
          })),
    ),
  };
}
