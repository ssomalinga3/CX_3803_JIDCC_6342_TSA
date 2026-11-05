import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { AppState, type AppStateStatus } from 'react-native';

import { LOCATION_FRESHNESS_MS, useMapLocation } from '@/hooks/use-map-location';

const { mockFocusState } = jest.requireMock('expo-router');
const permission = jest.mocked(Location.getForegroundPermissionsAsync);
const request = jest.mocked(Location.requestForegroundPermissionsAsync);
const services = jest.mocked(Location.hasServicesEnabledAsync);
const watch = jest.mocked(Location.watchPositionAsync);
const remove = jest.fn();
let update: Location.LocationCallback;
let error: Location.LocationErrorCallback | undefined;
let changeAppState: (state: AppStateStatus) => void;
const granted = { granted: true, canAskAgain: true, status: 'granted', expires: 'never' } as const;

function fix(latitude = 33.72, timestamp = Date.now()): Location.LocationObject {
  return {
    timestamp,
    coords: {
      latitude,
      longitude: -84.48,
      accuracy: 12,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusState.focused = true;
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    changeAppState = listener;
    return { remove: jest.fn() };
  });
  permission.mockResolvedValue(granted as Location.LocationPermissionResponse);
  request.mockResolvedValue(granted as Location.LocationPermissionResponse);
  services.mockResolvedValue(true);
  watch.mockImplementation(async (_options, callback, onError) => {
    update = callback;
    error = onError;
    return { remove };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('does not access GPS until requested; moving fixes stay in memory and stop on disable', async () => {
  const { result } = await renderHook(useMapLocation);
  expect(permission).not.toHaveBeenCalled();
  await act(() => result.current.enable());
  await waitFor(() => expect(watch).toHaveBeenCalledTimes(1));
  await act(() => update(fix()));
  expect(result.current.status).toBe('ready');
  await act(() => update(fix(33.721, Date.now() + 1)));
  expect(result.current.fix?.coords.latitude).toBe(33.721);
  await act(() => result.current.disable());
  expect(remove).toHaveBeenCalledTimes(1);
  expect(result.current.fix).toBeUndefined();
  await act(() => update(fix()));
  expect(result.current.status).toBe('off');
});

test.each([true, false])(
  'denial preserves browsing and reports whether the OS can ask again (%s)',
  async (canAskAgain) => {
    const denied = { ...granted, granted: false, status: 'denied', canAskAgain };
    permission.mockResolvedValue(denied as Location.LocationPermissionResponse);
    request.mockResolvedValue(denied as Location.LocationPermissionResponse);
    const { result } = await renderHook(useMapLocation);
    await act(() => result.current.enable());
    await waitFor(() => expect(result.current.status).toBe(canAskAgain ? 'denied' : 'blocked'));
    expect(request).toHaveBeenCalledTimes(canAskAgain ? 1 : 0);
    expect(watch).not.toHaveBeenCalled();
  },
);

test.each([true, false])(
  'device services off takes precedence over permission granted=%s',
  async (isGranted) => {
    services.mockResolvedValue(false);
    permission.mockResolvedValue({
      ...granted,
      granted: isGranted,
      canAskAgain: false,
      status: isGranted ? 'granted' : 'denied',
    } as Location.LocationPermissionResponse);
    const { result } = await renderHook(useMapLocation);
    await act(() => result.current.enable());
    await waitFor(() => expect(result.current.status).toBe('services-disabled'));
    expect(request).not.toHaveBeenCalled();
    expect(watch).not.toHaveBeenCalled();
  },
);

test('missing and stale fixes remove the dot, then recover with a fresh fix', async () => {
  jest.useFakeTimers();
  const { result } = await renderHook(useMapLocation);
  await act(() => result.current.enable());
  await act(() => jest.advanceTimersByTime(LOCATION_FRESHNESS_MS));
  expect(result.current.status).toBe('unavailable');
  await act(() => update(fix()));
  expect(result.current.status).toBe('ready');
  await act(() => jest.advanceTimersByTime(LOCATION_FRESHNESS_MS));
  expect(result.current.status).toBe('stale');
  expect(result.current.fix).toBeUndefined();
  await act(() => update(fix()));
  expect(result.current.status).toBe('ready');
});

test('ignores invalid, expired, and out-of-order fixes', async () => {
  const { result } = await renderHook(useMapLocation);
  await act(() => result.current.enable());
  await waitFor(() => expect(watch).toHaveBeenCalled());
  await act(() => update(fix(NaN)));
  await act(() => update(fix(100)));
  await act(() => update(fix(33.72, Date.now() - LOCATION_FRESHNESS_MS)));
  expect(result.current.fix).toBeUndefined();
  const latest = fix();
  await act(() => update(latest));
  await act(() => update(fix(33.73, latest.timestamp - 1000)));
  expect(result.current.fix).toEqual(latest);
});

test('background stops GPS; foreground rechecks permission without prompting', async () => {
  const { result } = await renderHook(useMapLocation);
  await act(() => result.current.enable());
  await waitFor(() => expect(watch).toHaveBeenCalledTimes(1));
  await act(() => update(fix()));
  await act(() => changeAppState('background'));
  expect(remove).toHaveBeenCalledTimes(1);
  expect(result.current.fix).toBeUndefined();
  permission.mockResolvedValue({
    ...granted,
    granted: false,
    canAskAgain: false,
  } as Location.LocationPermissionResponse);
  await act(() => changeAppState('active'));
  await waitFor(() => expect(result.current.status).toBe('blocked'));
  expect(request).not.toHaveBeenCalled();
  expect(watch).toHaveBeenCalledTimes(1);
});

test('the iOS permission dialog does not cancel an in-flight permission request', async () => {
  permission.mockResolvedValue({
    ...granted,
    granted: false,
  } as Location.LocationPermissionResponse);
  let allow!: (permission: Location.LocationPermissionResponse) => void;
  request.mockImplementation(
    () =>
      new Promise((resolve) => {
        allow = resolve;
      }),
  );
  const { result } = await renderHook(useMapLocation);
  await act(() => result.current.enable());
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  await act(() => changeAppState('inactive'));
  await act(() => changeAppState('active'));
  await act(() => allow(granted as Location.LocationPermissionResponse));
  await waitFor(() => expect(watch).toHaveBeenCalledTimes(1));
});

test('a map focused while inactive waits until active before requesting permission', async () => {
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'inactive' });
  permission.mockResolvedValue({
    ...granted,
    granted: false,
  } as Location.LocationPermissionResponse);
  const { result } = await renderHook(useMapLocation);
  await act(() => result.current.enable());
  expect(request).not.toHaveBeenCalled();
  await act(() => changeAppState('active'));
  await waitFor(() => expect(watch).toHaveBeenCalledTimes(1));
  expect(request).toHaveBeenCalledTimes(1);
});

test('tab blur stops updates and refocus acquires a fresh subscription', async () => {
  const { result, rerender } = await renderHook(useMapLocation);
  await act(() => result.current.enable());
  await waitFor(() => expect(watch).toHaveBeenCalledTimes(1));
  mockFocusState.focused = false;
  await rerender({});
  expect(remove).toHaveBeenCalledTimes(1);
  mockFocusState.focused = true;
  await rerender({});
  await waitFor(() => expect(watch).toHaveBeenCalledTimes(2));
});

test('a native subscription resolving after unmount is immediately removed', async () => {
  let finish!: (subscription: Location.LocationSubscription) => void;
  watch.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, unmount } = await renderHook(useMapLocation);
  await act(() => result.current.enable());
  await waitFor(() => expect(watch).toHaveBeenCalled());
  await unmount();
  await act(() => finish({ remove }));
  expect(remove).toHaveBeenCalledTimes(1);
});

test('native errors clear the fix and retry creates a new watcher', async () => {
  const { result } = await renderHook(useMapLocation);
  await act(() => result.current.enable());
  await waitFor(() => expect(watch).toHaveBeenCalledTimes(1));
  await act(() => update(fix()));
  await act(() => error?.('sensitive native error'));
  expect(result.current.status).toBe('unavailable');
  expect(result.current.fix).toBeUndefined();
  await act(() => result.current.enable());
  await waitFor(() => expect(watch).toHaveBeenCalledTimes(2));
});
