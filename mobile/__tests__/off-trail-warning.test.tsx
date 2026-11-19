import { act, render, screen, userEvent } from '@testing-library/react-native';
import type { LocationObject } from 'expo-location';
import { AccessibilityInfo } from 'react-native';

import PreserveMap from '@/components/preserve-map';
import { offTrailGeometry } from '@/data/off-trail';
import { MapGisProvider } from '@/hooks/map-gis-context';
import { useMapLocation, type LocationStatus } from '@/hooks/use-map-location';
import * as PublicGis from '@/hooks/use-public-gis';
import { offTrailPoints } from './fixtures/off-trail';
import { suppliedSnapshot } from './fixtures/supplied-gis';

jest.mock('@/hooks/use-map-location');
jest.mock('expo-file-system', () => {
  const files = new Map<string, string>();
  return {
    files,
    Paths: { document: 'documents' },
    File: class {
      private name: string;
      constructor(_directory: string, name: string) {
        this.name = name;
      }
      get exists() {
        return files.has(this.name);
      }
      get size() {
        return files.get(this.name)?.length ?? 0;
      }
      textSync() {
        return files.get(this.name)!;
      }
      create() {
        files.set(this.name, '');
      }
      write(value: string) {
        files.set(this.name, value);
      }
    },
  };
});

const { files } = jest.requireMock('expo-file-system') as { files: Map<string, string> };
const snapshot = suppliedSnapshot();
const points = offTrailPoints(offTrailGeometry(snapshot.collection)!);
const location = jest.mocked(useMapLocation);
let timestamp = 1;

function MapScreen() {
  return (
    <MapGisProvider>
      <PreserveMap />
    </MapGisProvider>
  );
}
function setFix([longitude, latitude]: number[], status: LocationStatus = 'ready') {
  const fix: LocationObject = {
    timestamp: timestamp++,
    coords: {
      longitude,
      latitude,
      accuracy: 5,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
  };
  location.mockReturnValue({ status, fix, enable: jest.fn(), disable: jest.fn() });
}
async function walkTo(view: Awaited<ReturnType<typeof render>>, point: number[], fixes = 3) {
  for (let i = 0; i < fixes; i += 1) {
    setFix(point);
    await view.rerender(<MapScreen />);
  }
}
const card = () => screen.queryByTestId('off-trail-warning');

beforeEach(() => {
  jest.clearAllMocks();
  files.clear();
  jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot, retry: jest.fn() });
  setFix(points.onTrail);
});

test('on-trail visitors see no warning; leaving the trail shows a friendly reminder', async () => {
  const view = await render(<MapScreen />);
  expect(card()).toBeNull();
  const displayed = screen.getByTestId('public-gis-source').props.data;
  // Two stray fixes are treated as GPS jitter.
  await walkTo(view, points.offTrail, 2);
  expect(card()).toBeNull();
  await walkTo(view, points.offTrail, 1);
  expect(card()).toBeOnTheScreen();
  expect(screen.getByText(/cause erosion/)).toBeOnTheScreen();
  expect(screen.getByTestId('off-trail-status')).toBeOnTheScreen();
  // Map browsing and the published layers remain available.
  expect(screen.getByTestId('public-gis-source').props.data).toEqual(displayed);
  expect(screen.getByRole('button', { name: 'Choose GIS layers' })).toBeEnabled();
});

test('"Got it" is the focused primary action and the reminder returns on the next departure', async () => {
  jest.useFakeTimers();
  const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
  try {
    const view = await render(<MapScreen />);
    await walkTo(view, points.offTrail);
    await act(() => jest.advanceTimersByTime(150));
    expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus');
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.press(screen.getByRole('button', { name: 'Got it' }));
    expect(card()).toBeNull();
    // The quieter status line keeps indicating the off-trail state.
    expect(screen.getByTestId('off-trail-status')).toBeOnTheScreen();
    await walkTo(view, points.offTrail);
    expect(card()).toBeNull();
    await walkTo(view, points.onTrail);
    expect(screen.queryByTestId('off-trail-status')).toBeNull();
    await walkTo(view, points.offTrail);
    expect(card()).toBeOnTheScreen();
    expect(files.size).toBe(0);
  } finally {
    focus.mockRestore();
    jest.useRealTimers();
  }
});

test('"Don\'t show again" persists across departures and app restarts', async () => {
  const view = await render(<MapScreen />);
  await walkTo(view, points.offTrail);
  await userEvent.setup().press(screen.getByRole('button', { name: "Don't show again" }));
  expect(card()).toBeNull();
  expect(JSON.parse(files.get('off-trail-warning.json')!)).toEqual({ version: 1, hidden: true });
  await walkTo(view, points.onTrail);
  await walkTo(view, points.offTrail);
  expect(card()).toBeNull();
  await view.unmount();

  setFix(points.onTrail);
  const restarted = await render(<MapScreen />);
  await walkTo(restarted, points.offTrail);
  expect(card()).toBeNull();
  expect(screen.getByTestId('off-trail-status')).toBeOnTheScreen();
});

test.each(['map blur', 'GIS refresh'] as const)(
  '"Got it" survives %s until the visitor returns to the trail and leaves again',
  async (interruption) => {
    const view = await render(<MapScreen />);
    await walkTo(view, points.offTrail);
    await userEvent.setup().press(screen.getByRole('button', { name: 'Got it' }));

    if (interruption === 'map blur') {
      // useMapLocation clears its fix on blur, then reacquires on focus.
      location.mockReturnValue({ status: 'off', enable: jest.fn(), disable: jest.fn() });
    } else {
      // A fresh API/cache snapshot has new object identity even with identical geometry.
      jest.mocked(PublicGis.usePublicGis).mockReturnValue({
        status: 'ready',
        snapshot: suppliedSnapshot(),
        retry: jest.fn(),
      });
    }
    await view.rerender(<MapScreen />);
    expect(card()).toBeNull();
    await walkTo(view, points.offTrail);
    expect(screen.getByTestId('off-trail-status')).toBeOnTheScreen();
    expect(card()).toBeNull();

    await walkTo(view, points.onTrail);
    await walkTo(view, points.offTrail);
    expect(card()).toBeOnTheScreen();
  },
);

test.each(['departure', 'return'] as const)(
  'stale GPS restarts partial confirmation of a %s',
  async (transition) => {
    const view = await render(<MapScreen />);
    if (transition === 'return') await walkTo(view, points.offTrail);
    const target = transition === 'departure' ? points.offTrail : points.onTrail;
    await walkTo(view, target, 2);
    location.mockReturnValue({ status: 'stale', enable: jest.fn(), disable: jest.fn() });
    await view.rerender(<MapScreen />);
    expect(card()).toBeNull();
    expect(screen.queryByTestId('off-trail-status')).toBeNull();

    // One fresh fix after a GPS outage must not complete the old confirmation.
    await walkTo(view, target, 1);
    if (transition === 'departure') {
      expect(card()).toBeNull();
      expect(screen.queryByTestId('off-trail-status')).toBeNull();
    } else {
      expect(screen.getByTestId('off-trail-status')).toBeOnTheScreen();
    }
    await walkTo(view, target, 2);
    if (transition === 'departure') {
      expect(card()).toBeOnTheScreen();
    } else {
      expect(card()).toBeNull();
      expect(screen.queryByTestId('off-trail-status')).toBeNull();
    }
  },
);

test('one near-trail fix after a GPS gap does not re-arm "Got it"', async () => {
  const view = await render(<MapScreen />);
  await walkTo(view, points.offTrail);
  await userEvent.setup().press(screen.getByRole('button', { name: 'Got it' }));
  location.mockReturnValue({ status: 'off', enable: jest.fn(), disable: jest.fn() });
  await view.rerender(<MapScreen />);
  // A single jittery fix near a trail is not a confirmed return.
  await walkTo(view, points.onTrail, 1);
  await walkTo(view, points.offTrail);
  expect(screen.getByTestId('off-trail-status')).toBeOnTheScreen();
  expect(card()).toBeNull();
});

test('leaving the preserve ends a dismissed departure', async () => {
  const view = await render(<MapScreen />);
  await walkTo(view, points.offTrail);
  await userEvent.setup().press(screen.getByRole('button', { name: 'Got it' }));
  await walkTo(view, points.outside, 1);
  // Re-entering through the woods, without touching a trail, is a new departure.
  await walkTo(view, points.offTrail);
  expect(card()).toBeOnTheScreen();
});

test('visitors outside the preserve are never told they left the trail', async () => {
  const view = await render(<MapScreen />);
  await walkTo(view, points.outside);
  expect(card()).toBeNull();
  expect(screen.queryByTestId('off-trail-status')).toBeNull();
  await walkTo(view, points.offTrail);
  expect(card()).toBeOnTheScreen();
});

test('location turned off or stale clears the indicator without flicker', async () => {
  const view = await render(<MapScreen />);
  await walkTo(view, points.offTrail);
  expect(card()).toBeOnTheScreen();
  setFix(points.offTrail, 'stale');
  await view.rerender(<MapScreen />);
  expect(card()).toBeNull();
  // A fresh fix after a stale period resumes the same departure (no re-confirmation).
  await walkTo(view, points.offTrail, 1);
  expect(card()).toBeOnTheScreen();
  location.mockReturnValue({ status: 'off', enable: jest.fn(), disable: jest.fn() });
  await view.rerender(<MapScreen />);
  expect(card()).toBeNull();
  expect(screen.queryByTestId('off-trail-status')).toBeNull();
});
