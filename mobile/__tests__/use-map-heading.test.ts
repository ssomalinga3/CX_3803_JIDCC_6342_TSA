import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { AppState, type AppStateStatus } from 'react-native';
import { useMapHeading } from '@/hooks/use-map-heading';
import { HEADING_FRESHNESS_MS } from '@/data/heading';

const { mockFocusState } = jest.requireMock('expo-router');
let update: Location.LocationHeadingCallback;
const remove = jest.fn();
let changeState: (state: AppStateStatus) => void;
beforeEach(() => {
  jest.clearAllMocks();
  mockFocusState.focused = true;
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    changeState = listener;
    return { remove: jest.fn() };
  });
  jest.mocked(Location.watchHeadingAsync).mockImplementation(async (callback) => {
    update = callback;
    return { remove };
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('drops background readings and creates a fresh subscription when foregrounded', async () => {
  const { result } = await renderHook(() => useMapHeading(true));
  await waitFor(() => expect(Location.watchHeadingAsync).toHaveBeenCalledTimes(1));
  const oldUpdate = update;
  await act(() => changeState('background'));
  expect(remove).toHaveBeenCalledTimes(1);
  await act(() => oldUpdate({ trueHeading: 90, magHeading: 85, accuracy: 3 }));
  expect(result.current).toBeUndefined();
  await act(() => changeState('active'));
  await waitFor(() => expect(Location.watchHeadingAsync).toHaveBeenCalledTimes(2));
  await act(() => update({ trueHeading: 180, magHeading: 175, accuracy: 3 }));
  expect(result.current).toBe(180);
});

test('starts only with a valid location and removes subscriptions on disable and blur', async () => {
  const { result, rerender } = await renderHook((enabled: boolean) => useMapHeading(enabled), {
    initialProps: false,
  });
  expect(Location.watchHeadingAsync).not.toHaveBeenCalled();
  await rerender(true);
  await waitFor(() => expect(Location.watchHeadingAsync).toHaveBeenCalledTimes(1));
  await act(() => update({ trueHeading: 90, magHeading: 85, accuracy: 3 }));
  expect(result.current).toBe(90);
  mockFocusState.focused = false;
  await rerender(true);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(result.current).toBeUndefined();
});

test('hides invalid and stale readings while preserving the position lifecycle', async () => {
  jest.useFakeTimers();
  const { result } = await renderHook(() => useMapHeading(true));
  await act(async () => {});
  await act(() => update({ trueHeading: 20, magHeading: 15, accuracy: 3 }));
  expect(result.current).toBe(20);
  await act(() => jest.advanceTimersByTime(HEADING_FRESHNESS_MS));
  expect(result.current).toBeUndefined();
  await act(() => update({ trueHeading: 70, magHeading: 65, accuracy: 0 }));
  expect(result.current).toBeUndefined();
});
