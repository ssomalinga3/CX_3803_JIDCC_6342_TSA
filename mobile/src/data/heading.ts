import type { LocationHeadingObject } from 'expo-location';
import type { Feature, Polygon } from 'geojson';

export const HEADING_FRESHNESS_MS = 5000;

export function headingDegrees(reading: LocationHeadingObject): number | undefined {
  if (!Number.isFinite(reading.accuracy) || reading.accuracy < 2) return;
  // True north is required to align with the geographic map. Never substitute travel course.
  if (!Number.isFinite(reading.trueHeading) || reading.trueHeading < 0 || reading.trueHeading > 360)
    return;
  return reading.trueHeading % 360;
}

export function smoothHeading(previous: number | undefined, next: number): number {
  if (previous === undefined) return next;
  const delta = ((next - previous + 540) % 360) - 180;
  return (previous + delta * 0.3 + 360) % 360;
}

/** Geographic cone rotates with the native map, including camera bearing changes. */
export function headingCone(
  longitude: number,
  latitude: number,
  heading: number,
  zoom: number,
): Feature<Polygon> {
  const meters = (22 * 156543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
  function point(bearing: number) {
    const angle = (bearing * Math.PI) / 180;
    return [
      longitude + (meters * Math.sin(angle)) / (111320 * Math.cos((latitude * Math.PI) / 180)),
      latitude + (meters * Math.cos(angle)) / 111320,
    ];
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [longitude, latitude],
          point(heading - 28),
          point(heading),
          point(heading + 28),
          [longitude, latitude],
        ],
      ],
    },
  };
}
