import { headingCone, headingDegrees, smoothHeading } from '@/data/heading';

test('requires a usable true compass heading without substituting magnetic heading or travel course', () => {
  expect(headingDegrees({ trueHeading: 360, magHeading: 50, accuracy: 3 })).toBe(0);
  expect(headingDegrees({ trueHeading: -1, magHeading: 50, accuracy: 3 })).toBeUndefined();
  expect(headingDegrees({ trueHeading: NaN, magHeading: 50, accuracy: 3 })).toBeUndefined();
  expect(headingDegrees({ trueHeading: 15, magHeading: 50, accuracy: 1 })).toBeUndefined();
});

test('smooths north crossing along the shortest arc', () => {
  expect(smoothHeading(359, 1)).toBeCloseTo(359.6);
  expect(smoothHeading(1, 359)).toBeCloseTo(0.4);
});

test('anchors the cone to geographic north and east independently of map bearing', () => {
  const north = headingCone(-84.48, 33.72, 0, 15).geometry.coordinates[0];
  const east = headingCone(-84.48, 33.72, 90, 15).geometry.coordinates[0];
  expect(north[0]).toEqual([-84.48, 33.72]);
  expect(north[2][0]).toBeCloseTo(-84.48);
  expect(north[2][1]).toBeGreaterThan(33.72);
  expect(east[2][0]).toBeGreaterThan(-84.48);
  expect(east[2][1]).toBeCloseTo(33.72);
});
