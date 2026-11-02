import { act, fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { AppState, Linking, type AppStateStatus } from 'react-native';

import LocationPermissionNotice from '@/components/location-permission-notice';
import { useLocationPermission } from '@/hooks/use-location-permission';

function PermissionOnly() {
  const access = useLocationPermission();
  return <LocationPermissionNotice access={access} />;
}

const location = jest.requireMock('expo-location');
const undetermined = {
  status: 'undetermined',
  granted: false,
  canAskAgain: true,
  expires: 'never',
};
const granted = { ...undetermined, status: 'granted', granted: true };
let onAppState: (state: AppStateStatus) => void;
const remove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  location.getForegroundPermissionsAsync.mockReset().mockResolvedValue(undetermined);
  location.requestForegroundPermissionsAsync.mockReset().mockResolvedValue(granted);
  location.hasServicesEnabledAsync.mockReset().mockResolvedValue(true);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    onAppState = callback;
    return { remove };
  });
  jest.spyOn(Linking, 'openSettings').mockResolvedValue();
});

afterEach(() => jest.restoreAllMocks());

test('only a tap requests foreground permission; granting access does not capture or transmit a fix', async () => {
  const user = userEvent.setup();
  const fetch = jest.spyOn(globalThis, 'fetch');
  await render(<PermissionOnly />);
  const allow = await screen.findByRole('button', { name: 'Allow location access' });
  expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  const requestCount = fetch.mock.calls.length;
  await user.press(allow);
  expect(await screen.findByText('Location access allowed while using the app.')).toBeOnTheScreen();
  expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
  expect(location.getLastKnownPositionAsync).not.toHaveBeenCalled();
  expect(location.watchPositionAsync).not.toHaveBeenCalled();
  expect(fetch.mock.calls).toHaveLength(requestCount);
});

test('denial offers an explicit permission retry', async () => {
  location.requestForegroundPermissionsAsync.mockResolvedValue({
    ...undetermined,
    status: 'denied',
  });
  const user = userEvent.setup();
  await render(<PermissionOnly />);
  await user.press(await screen.findByRole('button', { name: 'Allow location access' }));
  expect(
    await screen.findByText('Location access denied. You can still browse the map.'),
  ).toBeOnTheScreen();
  location.requestForegroundPermissionsAsync.mockResolvedValue(granted);
  await user.press(screen.getByRole('button', { name: 'Allow location access' }));
  expect(await screen.findByText('Location access allowed while using the app.')).toBeOnTheScreen();
});

test('blocked access opens Settings and detects permission changes and revocation on resume', async () => {
  location.getForegroundPermissionsAsync.mockResolvedValue({
    ...undetermined,
    status: 'denied',
    canAskAgain: false,
  });
  const user = userEvent.setup();
  const { unmount } = await render(<PermissionOnly />);
  await user.press(await screen.findByRole('button', { name: 'Open Settings' }));
  expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  location.getForegroundPermissionsAsync.mockResolvedValue(granted);
  await act(async () => onAppState('active'));
  expect(await screen.findByText('Location access allowed while using the app.')).toBeOnTheScreen();
  location.getForegroundPermissionsAsync.mockResolvedValue(undetermined);
  await act(async () => onAppState('active'));
  expect(await screen.findByRole('button', { name: 'Allow location access' })).toBeOnTheScreen();
  await unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

test('disabled device services are distinct from permission denial and network failure', async () => {
  location.getForegroundPermissionsAsync.mockResolvedValue(granted);
  location.hasServicesEnabledAsync.mockResolvedValue(false);
  const user = userEvent.setup();
  await render(<PermissionOnly />);
  expect(
    await screen.findByText('Device location services are off. You can still browse the map.'),
  ).toBeOnTheScreen();
  expect(screen.queryByText('Map unavailable. Check your connection.')).not.toBeOnTheScreen();
  location.hasServicesEnabledAsync.mockResolvedValue(true);
  await user.press(screen.getByRole('button', { name: 'Check location access' }));
  expect(await screen.findByText('Location access allowed while using the app.')).toBeOnTheScreen();
});

test('native and Settings failures have generic feedback and a usable retry', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  location.getForegroundPermissionsAsync.mockRejectedValueOnce(new Error('private GPS context'));
  const user = userEvent.setup();
  await render(<PermissionOnly />);
  await user.press(await screen.findByRole('button', { name: 'Check location access' }));
  expect(await screen.findByRole('button', { name: 'Allow location access' })).toBeOnTheScreen();
  location.requestForegroundPermissionsAsync.mockResolvedValue({
    ...undetermined,
    canAskAgain: false,
  });
  await user.press(screen.getByRole('button', { name: 'Allow location access' }));
  jest.mocked(Linking.openSettings).mockRejectedValueOnce(new Error('private settings context'));
  await user.press(await screen.findByRole('button', { name: 'Open Settings' }));
  expect(
    await screen.findByText('Location access could not be checked. You can still browse the map.'),
  ).toBeOnTheScreen();
  expect(log).not.toHaveBeenCalled();
});

test('a pending prompt is not duplicated by repeated taps or app-state events', async () => {
  let resolve: (value: typeof granted) => void = () => {};
  location.requestForegroundPermissionsAsync.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { unmount } = await render(<PermissionOnly />);
  const allow = await screen.findByRole('button', { name: 'Allow location access' });
  await fireEvent.press(allow);
  await fireEvent.press(allow);
  await act(async () => onAppState('active'));
  expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  await unmount();
  await act(async () => resolve(granted));
});

test('an old permission check cannot overwrite a newer grant', async () => {
  let resolve: (value: typeof undetermined) => void = () => {};
  location.getForegroundPermissionsAsync.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render(<PermissionOnly />);
  location.getForegroundPermissionsAsync.mockResolvedValue(granted);
  await act(async () => onAppState('active'));
  expect(await screen.findByText('Location access allowed while using the app.')).toBeOnTheScreen();
  await act(async () => resolve(undetermined));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Allow location access' })).not.toBeOnTheScreen(),
  );
});

test('a native prompt interrupted by inactive state rechecks after return without prompting twice', async () => {
  let resolve!: (value: typeof granted) => void;
  location.requestForegroundPermissionsAsync.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render(<PermissionOnly />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Allow location access' }));
  await act(async () => onAppState('inactive'));
  await act(async () => onAppState('active'));
  location.getForegroundPermissionsAsync.mockResolvedValue(granted);
  await act(async () => resolve(granted));
  expect(await screen.findByText('Location access allowed while using the app.')).toBeOnTheScreen();
  expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
});
