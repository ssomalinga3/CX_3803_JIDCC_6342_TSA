import { Platform } from 'react-native';
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

test('sizes the cone to about 22 screen pixels on MapLibre 512-pixel tiles', () => {
  const latitude = 33.72;
  const zoom = 16;
  const tip = headingCone(-84.48, latitude, 0, zoom).geometry.coordinates[0][2];
  const meters = (tip[1] - latitude) * 111320;
  const metersPerPixel = (78271.517 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
  expect(meters / metersPerPixel).toBeCloseTo(22, 5);
});

test('wraps Android true headings just west of true north instead of hiding them', () => {
  const os = Platform.OS;
  try {
    Platform.OS = 'android';
    // Observed on an Android 16 emulator in Atlanta: magnetic 0 with -5.63 degrees declination.
    expect(headingDegrees({ trueHeading: -5.63, magHeading: 0, accuracy: 3 })).toBeCloseTo(354.37);
    expect(headingDegrees({ trueHeading: -1, magHeading: 4, accuracy: 3 })).toBeUndefined();
    expect(headingDegrees({ trueHeading: 20.96, magHeading: 26.59, accuracy: 3 })).toBeCloseTo(
      20.96,
    );
    Platform.OS = 'ios';
    expect(headingDegrees({ trueHeading: -5.63, magHeading: 0, accuracy: 3 })).toBeUndefined();
  } finally {
    Platform.OS = os;
  }
});
