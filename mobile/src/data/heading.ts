import type { LocationHeadingObject } from 'expo-location';
import type { Feature, Polygon } from 'geojson';
import { Platform } from 'react-native';

export const HEADING_FRESHNESS_MS = 5000;
const CONE_PIXELS = 22;

export function headingDegrees(reading: LocationHeadingObject): number | undefined {
  if (!Number.isFinite(reading.accuracy) || reading.accuracy < 2) return;
  // True north is required to align with the geographic map. Never substitute travel course.
  let heading = reading.trueHeading;
  if (!Number.isFinite(heading) || heading > 360) return;
  if (heading < 0) {
    // -1 means true north is unavailable on both platforms, and iOS uses any negative value
    // for an unknown heading. Android reports (magnetic + declination) % 360, which is
    // negative just west of true north, so wrap those readings instead of hiding the cone.
    if (Platform.OS !== 'android' || heading === -1 || heading <= -360) return;
    heading += 360;
  }
  return heading % 360;
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
  // MapLibre zoom levels use 512-pixel tiles: 78271.517 meters per pixel at zoom 0.
  const meters = (CONE_PIXELS * 78271.517 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
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
