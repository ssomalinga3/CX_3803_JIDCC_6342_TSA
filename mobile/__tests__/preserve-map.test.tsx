import { act, fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import PreserveMap from '@/components/preserve-map';
import * as Location from 'expo-location';

const { mockZoomTo, mockEaseTo, mockGetZoom } = jest.requireMock('@maplibre/maplibre-react-native');

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
});

test('browsing becomes available only after native rendering; zoom follows the current viewport', async () => {
  const user = userEvent.setup();
  await render(<PreserveMap />);
  expect(screen.getByLabelText('Loading map')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
  expect(screen.getByText('Browse the map · Location off')).toBeOnTheScreen();
  expect(screen.getByText('Pan or pinch to explore')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Zoom in' }));
  expect(mockGetZoom).toHaveBeenCalledTimes(1);
  expect(mockZoomTo).toHaveBeenCalledWith(17, { duration: 200 });
  await user.press(screen.getByRole('button', { name: 'Return to preserve' }));
  expect(mockEaseTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 15, bearing: 0 }));
});

test('failed loading offers retry and can recover without enabling GPS', async () => {
  const user = userEvent.setup();
  await render(<PreserveMap />);
  await fireEvent(screen.getByTestId('preserve-map'), 'didFailLoadingMap');
  expect(screen.getByText('Map unavailable. Check your connection.')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Retry loading map' }));
  expect(screen.getByLabelText('Loading map')).toBeOnTheScreen();
  await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
  expect(screen.queryByRole('button', { name: 'Retry loading map' })).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
});

test('a silent first-load connection failure stops the spinner', async () => {
  jest.useFakeTimers();
  try {
    await render(<PreserveMap />);
    await fireEvent(screen.getByTestId('preserve-map'), 'didFailLoadingMap');
    await userEvent.setup().press(screen.getByRole('button', { name: 'Retry loading map' }));
    await act(async () => {
      jest.advanceTimersByTime(20000);
    });
    expect(screen.getByText('Map unavailable. Check your connection.')).toBeOnTheScreen();
  } finally {
    jest.useRealTimers();
  }
});

test('recenter uses the moving device fix rather than the preserve center', async () => {
  let update!: Location.LocationCallback;
  jest.mocked(Location.watchPositionAsync).mockImplementationOnce(async (_options, callback) => {
    update = callback;
    return { remove: jest.fn() };
  });
  await render(<PreserveMap />);
  await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
  expect(screen.getByRole('button', { name: 'Recenter on my location' })).toBeDisabled();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Use my location' }));
  await waitFor(() => expect(Location.watchPositionAsync).toHaveBeenCalled());
  await act(() =>
    update({
      timestamp: Date.now(),
      coords: {
        longitude: -84.48,
        latitude: 33.72,
        accuracy: 15,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
    }),
  );
  await userEvent.setup().press(screen.getByRole('button', { name: 'Recenter on my location' }));
  expect(mockEaseTo).toHaveBeenLastCalledWith(
    expect.objectContaining({
      center: [-84.48, 33.72],
      padding: expect.objectContaining({ top: 169, bottom: expect.any(Number) }),
    }),
  );
  await userEvent.setup().press(screen.getByRole('button', { name: 'Turn off map location' }));
  expect(screen.getByRole('button', { name: 'Recenter on my location' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
});
