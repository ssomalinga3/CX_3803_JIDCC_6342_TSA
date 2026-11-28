import type { GisSnapshot } from '@/data/gis';

/**
 * Provisional off-trail tolerances (Proposed, J6-24/J6-25). D-05 has not approved
 * numeric tolerances or protective geometry; these values only drive a friendly
 * reminder and must not be presented as navigation or safety guidance.
 *
 * Distances are measured from the supplied trail centerlines in meters. The gap
 * between ENTER and EXIT, the consecutive-fix requirement and the accuracy gate
 * keep ordinary GPS jitter from flickering the indicator.
 */
export const OFF_TRAIL_TOLERANCE = {
  /** A fix farther than this from every trail counts toward off-trail. */
  enterMeters: 20,
  /** A fix closer than this to any trail counts toward returning on-trail. */
  exitMeters: 12,
  /** Fixes reporting worse horizontal accuracy are ignored; the state is kept. */
  maxAccuracyMeters: 25,
  /** Consecutive qualifying fixes (≈1 s apart) needed to change state. */
  confirmFixes: 3,
  /** Without boundary polygons, only evaluate within this distance of a trail. */
  nearbyMeters: 150,
} as const;

type Position = number[];
export type OffTrailGeometry = {
  lines: Position[][];
  boundaries: Position[][][];
};

/** Trail lines and preserve boundary polygons from the full (not display-filtered) snapshot. */
export function offTrailGeometry(
  collection: GisSnapshot['collection'] | undefined,
): OffTrailGeometry | undefined {
  if (!collection) return;
  const lines: Position[][] = [];
  const boundaries: Position[][][] = [];
  for (const { geometry, properties } of collection.features) {
    const kind = properties.feature_kind;
    if (kind === 'trail') {
      if (geometry.type === 'LineString') lines.push(geometry.coordinates);
      else if (geometry.type === 'MultiLineString') lines.push(...geometry.coordinates);
    } else if (kind === 'boundary') {
      if (geometry.type === 'Polygon') boundaries.push(geometry.coordinates);
      else if (geometry.type === 'MultiPolygon') boundaries.push(...geometry.coordinates);
    }
  }
  return lines.length ? { lines, boundaries } : undefined;
}

const METERS_PER_DEGREE_LAT = 110_574;
const METERS_PER_DEGREE_LON_EQUATOR = 111_320;

/**
 * Shortest distance in meters from a [lon, lat] point to any trail line. A local
 * equirectangular projection is accurate to well under a meter at preserve scale.
 */
export function distanceToTrailMeters(geometry: OffTrailGeometry, point: Position): number {
  const [lon0, lat0] = point;
  const kx = Math.cos((lat0 * Math.PI) / 180) * METERS_PER_DEGREE_LON_EQUATOR;
  const ky = METERS_PER_DEGREE_LAT;
  let best = Infinity;
  for (const line of geometry.lines) {
    for (let i = 1; i < line.length; i += 1) {
      const ax = (line[i - 1][0] - lon0) * kx;
      const ay = (line[i - 1][1] - lat0) * ky;
      const dx = (line[i][0] - lon0) * kx - ax;
      const dy = (line[i][1] - lat0) * ky - ay;
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}

function insideRing(ring: Position[], [x, y]: Position) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when the point lies inside a boundary polygon (outer ring, excluding holes). */
export function insidePreserve(geometry: OffTrailGeometry, point: Position): boolean {
  return geometry.boundaries.some(
    ([outer, ...holes]) =>
      insideRing(outer, point) && !holes.some((hole) => insideRing(hole, point)),
  );
}

export type OffTrailStatus = 'unknown' | 'on-trail' | 'off-trail';
export type OffTrailState = {
  status: OffTrailStatus;
  /** Consecutive qualifying fixes pointing at the other state. */
  pending: number;
};
export const INITIAL_OFF_TRAIL: OffTrailState = { status: 'unknown', pending: 0 };

export type OffTrailFix = { longitude: number; latitude: number; accuracy: number | null };

/**
 * Advance the on/off-trail state by one location fix. Pure so the jitter buffer
 * can be tested with known positions and simulated walks.
 */
export function nextOffTrailState(
  state: OffTrailState,
  geometry: OffTrailGeometry,
  fix: OffTrailFix,
  tolerance = OFF_TRAIL_TOLERANCE,
): OffTrailState {
  // Unknown accuracy or a poor fix cannot distinguish a trail from the woods beside it.
  if (fix.accuracy === null || fix.accuracy > tolerance.maxAccuracyMeters) return state;
  const point = [fix.longitude, fix.latitude];
  const distance = distanceToTrailMeters(geometry, point);
  const inPreserve = geometry.boundaries.length
    ? insidePreserve(geometry, point)
    : distance <= tolerance.nearbyMeters;
  // Visitors outside the preserve (streets, parking, home) are not "off trail".
  if (!inPreserve) return INITIAL_OFF_TRAIL;

  const target: OffTrailStatus | undefined =
    distance > tolerance.enterMeters
      ? 'off-trail'
      : distance < tolerance.exitMeters
        ? 'on-trail'
        : undefined;
  // Inside the hysteresis band: hold the current state and restart confirmation.
  if (!target) return state.pending ? { ...state, pending: 0 } : state;
  if (target === state.status) return state.pending ? { ...state, pending: 0 } : state;
  // The first in-preserve fix may settle "on trail" immediately; going off always needs confirmation.
  if (state.status === 'unknown' && target === 'on-trail') return { status: target, pending: 0 };
  const pending = state.pending + 1;
  return pending >= tolerance.confirmFixes ? { status: target, pending: 0 } : { ...state, pending };
}
