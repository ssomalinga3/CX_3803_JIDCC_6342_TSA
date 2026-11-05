import { act, fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import PreserveMap from '@/components/preserve-map';
import * as Location from 'expo-location';
import * as PublicGis from '@/hooks/use-public-gis';
import { collection, layer } from './fixtures/gis';

const { mockZoomTo, mockEaseTo, mockGetZoom, mockFitBounds } = jest.requireMock(
  '@maplibre/maplibre-react-native',
);

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
});

test('refits the loaded route after measuring the legend panel without refitting unchanged layouts', async () => {
  const gis = jest.spyOn(PublicGis, 'usePublicGis').mockReturnValue({
    status: 'ready',
    retry: jest.fn(),
    snapshot: {
      layers: [layer],
      collection,
      bounds: [-84.48, 33.72, -84.47, 33.73],
      isDemo: false,
    },
  });
  try {
    await render(<PreserveMap />);
    await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
    const previousPadding = mockFitBounds.mock.calls.at(-1)[1].padding.bottom;
    await fireEvent(screen.getByText('Pan or pinch to explore').parent!, 'layout', {
      nativeEvent: { layout: { height: 380 } },
    });
    expect(mockFitBounds.mock.calls.at(-1)[1].padding.bottom).toBeGreaterThan(previousPadding);
    const count = mockFitBounds.mock.calls.length;
    await fireEvent(screen.getByText('Pan or pinch to explore').parent!, 'layout', {
      nativeEvent: { layout: { height: 380 } },
    });
    expect(mockFitBounds).toHaveBeenCalledTimes(count);
  } finally {
    gis.mockRestore();
  }
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

test('approximate-name notice remains visible while browsing with denied location permission', async () => {
  const gis = jest.spyOn(PublicGis, 'usePublicGis').mockReturnValue({
    status: 'ready',
    retry: jest.fn(),
    snapshot: {
      layers: [layer],
      collection: {
        ...collection,
        features: [
          {
            ...collection.features[0],
            properties: {
              name: 'Terrace Trail',
              trail_id: 'terrace',
              feature_kind: 'trail',
              name_assignment: 'approximate',
            },
          },
        ],
      },
      bounds: null,
      isDemo: false,
    },
  });
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValueOnce({
    granted: false,
    canAskAgain: false,
    status: 'denied' as Location.PermissionStatus,
    expires: 'never',
  });
  try {
    await render(<PreserveMap />);
    await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
    await userEvent.setup().press(screen.getByRole('button', { name: 'Use my location' }));
    expect(
      screen.getByText('Location access is off. Enable it in Settings to see your position.'),
    ).toBeOnTheScreen();
    expect(
      screen.getByText('Approximate trail names · Partial network. Check park signs.'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByLabelText('Terrace Trail: Purple')).toBeOnTheScreen();
    expect(
      screen.queryByText('Orange trails · Purple boundary · Blue landmarks'),
    ).not.toBeOnTheScreen();
  } finally {
    gis.mockRestore();
  }
});

test('legend updates with loaded routes, deduplicates sections, and disappears for empty data', async () => {
  const snapshot = {
    layers: [layer],
    collection: {
      ...collection,
      features: ['gateway', 'gateway', null].map((id, index) => ({
        ...collection.features[0],
        id: `section-${index}`,
        properties: id
          ? { feature_kind: 'trail', trail_id: id }
          : { name_assignment: 'unassigned' },
      })),
    },
    bounds: null,
    isDemo: false,
  };
  const gis = jest.spyOn(PublicGis, 'usePublicGis').mockReturnValue({
    status: 'ready',
    retry: jest.fn(),
    snapshot,
  });
  try {
    const view = await render(<PreserveMap />);
    expect(screen.getAllByLabelText('Gateway Trail: White')).toHaveLength(1);
    expect(screen.getByLabelText('Unnamed connections: Gray, dashed')).toBeOnTheScreen();
    expect(screen.queryByText('Bigleaf Magnolia Trail')).not.toBeOnTheScreen();
    expect(screen.queryByText('Spur Trails')).not.toBeOnTheScreen();
    gis.mockReturnValue({
      status: 'empty',
      retry: jest.fn(),
      snapshot: { ...snapshot, collection: { type: 'FeatureCollection', features: [] } },
    });
    await view.rerender(<PreserveMap />);
    expect(screen.queryByText('Trail colors · Swipe for more')).not.toBeOnTheScreen();
  } finally {
    gis.mockRestore();
  }
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
