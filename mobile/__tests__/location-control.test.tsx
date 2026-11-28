import { act, fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { AccessibilityInfo, AppState, Linking, type AppStateStatus } from 'react-native';

import PreserveMap from '@/components/preserve-map';
import { MapGisProvider } from '@/hooks/map-gis-context';

const { mockEaseTo, mockGetZoom } = jest.requireMock('@maplibre/maplibre-react-native');
const { mockFocusState } = jest.requireMock('expo-router');
const permission = jest.mocked(Location.getForegroundPermissionsAsync);
const request = jest.mocked(Location.requestForegroundPermissionsAsync);
const watch = jest.mocked(Location.watchPositionAsync);
const granted = { granted: true, canAskAgain: true, status: 'granted', expires: 'never' } as const;
const denied = { ...granted, granted: false, status: 'denied' } as const;
let update: Location.LocationCallback;
let changeAppState: (state: AppStateStatus) => void;

function MapScreen() {
  return (
    <MapGisProvider>
      <PreserveMap />
    </MapGisProvider>
  );
}
const follow = () => screen.getByRole('button', { name: 'Follow my location' });
async function readyMap() {
  const view = await render(<MapScreen />);
  await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
  mockEaseTo.mockClear();
  return view;
}
async function publishFix() {
  await act(() =>
    update({
      timestamp: Date.now(),
      coords: {
        longitude: -84.48,
        latitude: 33.72,
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
    }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetZoom.mockReset().mockResolvedValue(14);
  mockFocusState.focused = true;
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    changeAppState = listener;
    return { remove: jest.fn() };
  });
  permission.mockResolvedValue(granted as Location.LocationPermissionResponse);
  request.mockResolvedValue(granted as Location.LocationPermissionResponse);
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
  watch.mockImplementation(async (_options, callback) => {
    update = callback;
    return { remove: jest.fn() };
  });
});
afterEach(() => {
  mockFocusState.focused = true;
  jest.restoreAllMocks();
});

test('one location control requests permission only on tap and follows the first fix without a second tap', async () => {
  permission.mockResolvedValue(denied as Location.LocationPermissionResponse);
  let authorize!: (value: Location.LocationPermissionResponse) => void;
  request.mockReturnValueOnce(
    new Promise((resolve) => {
      authorize = resolve;
    }),
  );
  await readyMap();
  expect(follow()).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Use my location' })).not.toBeOnTheScreen();
  expect(permission).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  await userEvent.setup().press(follow());
  expect(request).toHaveBeenCalledTimes(1);
  expect(follow()).toBeBusy();
  expect(follow()).toBeDisabled();
  await userEvent.setup().press(follow());
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => authorize(granted as Location.LocationPermissionResponse));
  await waitFor(() => expect(watch).toHaveBeenCalledTimes(1));
  expect(follow()).toBeBusy();
  await publishFix();
  await waitFor(() => expect(follow()).toBeSelected());
  expect(follow()).toBeEnabled();
  expect(follow()).not.toBeBusy();
  expect(mockEaseTo).toHaveBeenLastCalledWith(
    expect.objectContaining({
      center: [-84.48, 33.72],
      zoom: 15.5,
    }),
  );
});

test('collapsing and expanding the HUD preserves live following without a camera command or permission request', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  await readyMap();
  await userEvent.setup().press(follow());
  await waitFor(() => expect(watch).toHaveBeenCalledTimes(1));
  await publishFix();
  await waitFor(() => expect(follow()).toBeSelected());
  const calls = mockEaseTo.mock.calls.length;
  const permissionCalls = permission.mock.calls.length;
  await userEvent.setup().press(screen.getByRole('button', { name: 'Collapse map details' }));
  await userEvent.setup().press(screen.getByRole('button', { name: 'Show all map information' }));
  expect(follow()).toBeSelected();
  expect(watch).toHaveBeenCalledTimes(1);
  expect(permission).toHaveBeenCalledTimes(permissionCalls);
  expect(request).not.toHaveBeenCalled();
  expect(mockEaseTo).toHaveBeenCalledTimes(calls);
});

test('denial preserves browsing and cancels pending follow even if permission later recovers', async () => {
  permission.mockResolvedValue(denied as Location.LocationPermissionResponse);
  request.mockResolvedValue(denied as Location.LocationPermissionResponse);
  await readyMap();
  await userEvent.setup().press(follow());
  expect(
    screen.getByText('Location permission denied. You can still browse the map.'),
  ).toBeOnTheScreen();
  expect(follow()).toBeEnabled();
  expect(follow()).not.toBeSelected();
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
  expect(watch).not.toHaveBeenCalled();
  permission.mockResolvedValue(granted as Location.LocationPermissionResponse);
  await act(() => changeAppState('background'));
  await act(() => changeAppState('active'));
  await waitFor(() => expect(watch).toHaveBeenCalledTimes(1));
  await publishFix();
  expect(follow()).not.toBeSelected();
  expect(mockEaseTo).not.toHaveBeenCalled();
  await userEvent.setup().press(follow());
  expect(follow()).toBeSelected();
});

test('blocked location offers Settings from the same icon and keeps accessible recovery feedback', async () => {
  const settings = jest
    .spyOn(Linking, 'openSettings')
    .mockRejectedValueOnce(new Error('Unavailable'));
  permission.mockResolvedValue({
    ...denied,
    canAskAgain: false,
  } as Location.LocationPermissionResponse);
  await readyMap();
  await userEvent.setup().press(follow());
  expect(request).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Open location settings' })).toBeEnabled();
  await userEvent.setup().press(follow());
  expect(settings).toHaveBeenCalledTimes(1);
  expect(
    screen.getByText('Could not open Settings. Open device Settings manually.'),
  ).toBeOnTheScreen();
});

test('disabled services retain a retryable location control without a permission prompt', async () => {
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValueOnce(false);
  await readyMap();
  await userEvent.setup().press(follow());
  expect(
    screen.getByText('Device location services are off. You can still browse the map.'),
  ).toBeOnTheScreen();
  expect(follow()).toBeEnabled();
  expect(request).not.toHaveBeenCalled();
  await userEvent.setup().press(follow());
  await waitFor(() => expect(watch).toHaveBeenCalledTimes(1));
  await publishFix();
  expect(follow()).toBeSelected();
});

test.each(['drag', 'return', 'disable', 'background', 'blur', 'map failure'])(
  '%s cancels first-fix follow while GPS is still being acquired',
  async (action) => {
    const view = await readyMap();
    await userEvent.setup().press(follow());
    await waitFor(() => expect(watch).toHaveBeenCalledTimes(1));
    if (action === 'drag')
      await fireEvent(screen.getByTestId('preserve-map'), 'regionWillChange', {
        nativeEvent: { userInteraction: true },
      });
    if (action === 'return')
      await userEvent.setup().press(screen.getByRole('button', { name: 'Return to preserve' }));
    if (action === 'disable')
      await userEvent.setup().press(screen.getByRole('button', { name: 'Turn off map location' }));
    if (action === 'background') {
      await act(() => changeAppState('background'));
      await act(() => changeAppState('active'));
      await waitFor(() => expect(watch).toHaveBeenCalledTimes(2));
    }
    if (action === 'blur') {
      mockFocusState.focused = false;
      await view.rerender(<MapScreen />);
      mockFocusState.focused = true;
      await view.rerender(<MapScreen />);
      await waitFor(() => expect(watch).toHaveBeenCalledTimes(2));
    }
    if (action === 'map failure')
      await fireEvent(screen.getByTestId('preserve-map'), 'didFailLoadingMap');
    mockEaseTo.mockClear();
    await publishFix();
    if (action === 'map failure')
      await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
    expect(mockEaseTo).not.toHaveBeenCalled();
    expect(follow()).not.toBeSelected();
  },
);
