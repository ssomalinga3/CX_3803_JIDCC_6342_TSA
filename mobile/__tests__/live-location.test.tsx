import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import type { LocationObject } from 'expo-location';

import PreserveMap from '@/components/preserve-map';
import { currentCenter, FIX_MAX_AGE_MS, useLiveLocation } from '@/hooks/use-live-location';
import { useLocationPermission } from '@/hooks/use-location-permission';

const location = jest.requireMock('expo-location');
const { mockEaseTo } = jest.requireMock('@maplibre/maplibre-react-native');
const refresh = jest.fn().mockResolvedValue(undefined);
const access = {
  status: 'granted' as const,
  approximate: false,
  busy: false,
  refresh,
  request: refresh,
  openSettings: refresh,
};
let callbacks: ((fix: LocationObject) => void)[];
let errors: (() => void)[];
let listeners: Set<(state: AppStateStatus) => void>;
const remove = jest.fn();
const fix = (timestamp = Date.now(), longitude = -84.48): LocationObject => ({
  timestamp,
  coords: {
    latitude: 33.72,
    longitude,
    accuracy: 15,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
  },
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  callbacks = [];
  errors = [];
  listeners = new Set();
  location.getForegroundPermissionsAsync.mockResolvedValue({
    granted: true,
    ios: { accuracy: 'reduced' },
  });
  location.hasServicesEnabledAsync.mockResolvedValue(true);
  location.watchPositionAsync.mockImplementation(
    (_options: unknown, callback: (typeof callbacks)[number], error: () => void) => {
      callbacks.push(callback);
      errors.push(error);
      return Promise.resolve({ remove });
    },
  );
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    listeners.add(callback);
    return {
      remove: () => {
        listeners.delete(callback);
      },
    };
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('blur, permission loss and unmount remove watches and ignore late callbacks', async () => {
  const { result, rerender, unmount } = await renderHook(
    ({ active, allowed }: { active: boolean; allowed: boolean }) =>
      useLiveLocation(active, { ...access, status: allowed ? 'granted' : 'denied' }),
    { initialProps: { active: true, allowed: true } },
  );
  await act(async () => callbacks[0](fix()));
  expect(result.current.status).toBe('live');
  await rerender({ active: false, allowed: true });
  expect(remove).toHaveBeenCalledTimes(1);
  await act(async () => callbacks[0](fix()));
  expect(result.current.fix).toBeNull();
  await rerender({ active: true, allowed: true });
  await rerender({ active: true, allowed: false });
  expect(remove).toHaveBeenCalledTimes(2);
  await rerender({ active: true, allowed: true });
  await unmount();
  expect(remove).toHaveBeenCalledTimes(3);
  await act(async () => {
    callbacks[2](fix());
    errors[2]();
  });
});

test('background stops immediately; a late subscription is removed when it resolves', async () => {
  let resolve!: (value: { remove: typeof remove }) => void;
  location.watchPositionAsync.mockImplementationOnce(
    (_options: unknown, callback: (typeof callbacks)[number]) => {
      callbacks.push(callback);
      return new Promise((done) => {
        resolve = done;
      });
    },
  );
  const { result } = await renderHook(() => useLiveLocation(true, access));
  await act(async () => {
    listeners.forEach((listener) => listener('background'));
  });
  await act(async () => {
    resolve({ remove });
    callbacks[0](fix());
  });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(result.current.fix).toBeNull();
});

test('missing fixes time out; stale, invalid, future and out-of-order fixes cannot appear current', async () => {
  const { result } = await renderHook(() => useLiveLocation(true, access));
  expect(result.current.status).toBe('acquiring');
  expect(location.watchPositionAsync).toHaveBeenCalledWith(
    expect.objectContaining({ mayShowUserSettingsDialog: false }),
    expect.any(Function),
    expect.any(Function),
  );
  await act(async () => {
    jest.advanceTimersByTime(20_000);
  });
  expect(result.current.status).toBe('unavailable');
  await act(async () => callbacks[0](fix(Date.now() - FIX_MAX_AGE_MS)));
  expect(result.current.status).toBe('stale');
  await act(async () => {
    callbacks[0](fix(Date.now(), NaN));
    callbacks[0](fix(Date.now() + 1000));
  });
  expect(result.current.fix).toBeNull();
  await act(async () => callbacks[0](fix()));
  expect(result.current.status).toBe('live');
  await act(async () => callbacks[0](fix(Date.now() - 1, 10)));
  expect(result.current.fix?.center).toEqual([-84.48, 33.72]);
  const previous = result.current.fix;
  await act(async () => {
    jest.advanceTimersByTime(FIX_MAX_AGE_MS);
  });
  expect(result.current.status).toBe('stale');
  expect(currentCenter(previous)).toBeNull();
  expect(result.current.fix).toBeNull();
  await act(async () => callbacks[0](fix()));
  expect(result.current.status).toBe('live');
});

test('watch errors are generic, stop tracking, and retry starts a new session', async () => {
  const { result } = await renderHook(() => useLiveLocation(true, access));
  await act(async () => callbacks[0](fix()));
  await act(async () => errors[0]());
  expect(result.current.status).toBe('unavailable');
  expect(result.current.fix).toBeNull();
  expect(remove).toHaveBeenCalledTimes(1);
  await act(async () => result.current.retry());
  await act(async () => callbacks[0](fix()));
  expect(result.current.status).toBe('acquiring');
  await act(async () => callbacks[1](fix()));
  expect(result.current.status).toBe('live');
});

test('foreground polling detects silent revocation; resume rechecks before tracking', async () => {
  const { result } = await renderHook(() => {
    const permission = useLocationPermission();
    return useLiveLocation(true, permission);
  });
  await act(async () => callbacks[0](fix()));
  location.getForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(result.current.fix).toBeNull();
  expect(remove).toHaveBeenCalledTimes(1);
  await act(async () => {
    listeners.forEach((listener) => listener('background'));
  });
  location.getForegroundPermissionsAsync.mockResolvedValue({ granted: true });
  await act(async () => {
    listeners.forEach((listener) => listener('active'));
  });
  expect(result.current.status).toBe('acquiring');
  expect(location.watchPositionAsync).toHaveBeenCalledTimes(2);
});

test('only recenter moves the camera to a fresh fix; reduced access and GPS failure leave browsing usable', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch');
  await render(<PreserveMap />);
  await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
  expect(screen.getByRole('button', { name: 'Recenter to current location' })).toBeDisabled();
  const requests = fetch.mock.calls.length;
  await act(async () => callbacks[0](fix()));
  expect(mockEaseTo).not.toHaveBeenCalled();
  expect(screen.getByText(/Approximate location/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Recenter to current location' }));
  expect(mockEaseTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [-84.48, 33.72] }));
  await act(async () => {
    jest.advanceTimersByTime(1000);
    callbacks[0](fix(Date.now(), -84.49));
  });
  expect(mockEaseTo).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Return to preserve' }));
  expect(mockEaseTo).toHaveBeenLastCalledWith(
    expect.objectContaining({ center: [-84.4792, 33.7176] }),
  );
  await act(async () => errors[0]());
  expect(
    screen.getByText('GPS position unavailable. You can still browse the map.'),
  ).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Recenter to current location' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
  expect(fetch.mock.calls).toHaveLength(requests);
  expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

test('revalidation blocks capture after permission or services change; native rejection is recoverable', async () => {
  location.getForegroundPermissionsAsync.mockResolvedValue({ granted: false });
  const first = await renderHook(() => useLiveLocation(true, access));
  expect(first.result.current.status).toBe('unavailable');
  expect(location.watchPositionAsync).not.toHaveBeenCalled();
  await first.unmount();
  location.getForegroundPermissionsAsync.mockResolvedValue({ granted: true });
  location.hasServicesEnabledAsync.mockResolvedValue(false);
  const second = await renderHook(() => useLiveLocation(true, access));
  expect(location.watchPositionAsync).not.toHaveBeenCalled();
  await second.unmount();
  location.hasServicesEnabledAsync.mockResolvedValue(true);
  location.watchPositionAsync.mockRejectedValueOnce(new Error('private coordinates'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const third = await renderHook(() => useLiveLocation(true, access));
  expect(third.result.current.status).toBe('unavailable');
  expect(log).not.toHaveBeenCalled();
});
