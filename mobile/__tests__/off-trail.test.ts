import {
  INITIAL_OFF_TRAIL,
  OFF_TRAIL_TOLERANCE,
  distanceToTrailMeters,
  insidePreserve,
  nextOffTrailState,
  offTrailGeometry,
  type OffTrailFix,
  type OffTrailGeometry,
  type OffTrailState,
} from '@/data/off-trail';
import { offTrailPoints } from './fixtures/off-trail';
import { suppliedSnapshot } from './fixtures/supplied-gis';

const geometry = offTrailGeometry(suppliedSnapshot().collection)!;
const points = offTrailPoints(geometry);
const fix = ([longitude, latitude]: number[], accuracy: number | null = 5): OffTrailFix => ({
  longitude,
  latitude,
  accuracy,
});
function walk(path: OffTrailFix[], start: OffTrailState = INITIAL_OFF_TRAIL) {
  const states = [start];
  for (const step of path) states.push(nextOffTrailState(states.at(-1)!, geometry, step));
  return states.slice(1).map((state) => state.status);
}

test('reads supplied trail centerlines and preserve boundary from the full snapshot', () => {
  expect(geometry.lines.length).toBeGreaterThanOrEqual(36);
  expect(geometry.boundaries.length).toBeGreaterThan(0);
  expect(offTrailGeometry(undefined)).toBeUndefined();
  expect(
    offTrailGeometry({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'road',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-84, 33],
              [-84.1, 33],
            ],
          },
          properties: { feature_kind: 'road' },
        },
      ],
    }),
  ).toBeUndefined();
});

test('measures known distances in meters', () => {
  const line: OffTrailGeometry = {
    lines: [
      [
        [-84.48, 33.72],
        [-84.47, 33.72],
      ],
    ],
    boundaries: [],
  };
  expect(distanceToTrailMeters(line, [-84.475, 33.72])).toBeCloseTo(0, 5);
  // 0.0003° latitude ≈ 33.2 m north of an east-west line.
  expect(distanceToTrailMeters(line, [-84.475, 33.7203])).toBeCloseTo(33.17, 1);
  // Beyond the end vertex the nearest point is the vertex itself.
  expect(distanceToTrailMeters(line, [-84.4797, 33.72])).toBeCloseTo(0, 5);
  expect(distanceToTrailMeters(line, [-84.4803, 33.72])).toBeCloseTo(27.8, 0);
  expect(distanceToTrailMeters(geometry, points.onTrail)).toBeLessThan(1);
  expect(distanceToTrailMeters(geometry, points.offTrail)).toBeGreaterThan(35);
  expect(distanceToTrailMeters(geometry, points.band)).toBeGreaterThan(
    OFF_TRAIL_TOLERANCE.exitMeters,
  );
  expect(distanceToTrailMeters(geometry, points.band)).toBeLessThan(
    OFF_TRAIL_TOLERANCE.enterMeters,
  );
  expect(insidePreserve(geometry, points.offTrail)).toBe(true);
  expect(insidePreserve(geometry, points.outside)).toBe(false);
});

test('a single stray fix never flags off-trail; three consecutive fixes do', () => {
  expect(walk([fix(points.onTrail), fix(points.offTrail), fix(points.onTrail)])).toEqual([
    'on-trail',
    'on-trail',
    'on-trail',
  ]);
  expect(
    walk([fix(points.onTrail), fix(points.offTrail), fix(points.offTrail), fix(points.offTrail)]),
  ).toEqual(['on-trail', 'on-trail', 'on-trail', 'off-trail']);
});

test('hysteresis band holds the current state so jitter does not flicker', () => {
  const off = walk(Array(3).fill(fix(points.offTrail)));
  expect(off.at(-1)).toBe('off-trail');
  const offState: OffTrailState = { status: 'off-trail', pending: 0 };
  // Drifting into the band while off-trail does not count as returning.
  expect(walk(Array(6).fill(fix(points.band)), offState)).toEqual(Array(6).fill('off-trail'));
  const onState: OffTrailState = { status: 'on-trail', pending: 0 };
  expect(walk(Array(6).fill(fix(points.band)), onState)).toEqual(Array(6).fill('on-trail'));
  // Alternating band/off fixes restart confirmation, so the state never changes.
  expect(
    walk([fix(points.offTrail), fix(points.band), fix(points.offTrail), fix(points.band)], onState),
  ).toEqual(Array(4).fill('on-trail'));
  // Returning requires confirmation too.
  expect(walk(Array(3).fill(fix(points.onTrail)), offState)).toEqual([
    'off-trail',
    'off-trail',
    'on-trail',
  ]);
});

test('poor or unknown accuracy keeps the previous state', () => {
  const onState: OffTrailState = { status: 'on-trail', pending: 0 };
  expect(walk(Array(5).fill(fix(points.offTrail, 60)), onState)).toEqual(Array(5).fill('on-trail'));
  expect(walk(Array(5).fill(fix(points.offTrail, null)), onState)).toEqual(
    Array(5).fill('on-trail'),
  );
  // An accurate fix after poor ones still needs the full confirmation count.
  expect(
    walk(
      [fix(points.offTrail), fix(points.offTrail, 80), fix(points.offTrail), fix(points.offTrail)],
      onState,
    ),
  ).toEqual(['on-trail', 'on-trail', 'on-trail', 'off-trail']);
});

test('outside the preserve the status is unknown', () => {
  const offState: OffTrailState = { status: 'off-trail', pending: 0 };
  expect(walk([fix(points.outside)], offState)).toEqual(['unknown']);
  // Without boundary polygons, distance from the trails gates evaluation.
  const noBoundary = { ...geometry, boundaries: [] };
  expect(nextOffTrailState(offState, noBoundary, fix(points.outside)).status).toBe('unknown');
});

test('simulated walk: along a trail, into the woods, and back', () => {
  const route = points.route;
  const statuses = walk(route.map((position) => fix(position)));
  const transitions = statuses.filter((status, i) => i === 0 || status !== statuses[i - 1]);
  expect(transitions).toEqual(['on-trail', 'off-trail', 'on-trail']);
  // Detection happens a few fixes after crossing the threshold, not instantly.
  const firstOff = statuses.indexOf('off-trail');
  const firstBeyond = route.findIndex(
    (position) => distanceToTrailMeters(geometry, position) > OFF_TRAIL_TOLERANCE.enterMeters,
  );
  expect(firstOff - firstBeyond).toBe(OFF_TRAIL_TOLERANCE.confirmFixes - 1);
});
