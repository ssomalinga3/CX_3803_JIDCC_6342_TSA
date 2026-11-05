import { act, fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import PreserveMap from '@/components/preserve-map';
import * as Location from 'expo-location';
import * as PublicGis from '@/hooks/use-public-gis';
import { collection, layer } from './fixtures/gis';
import type { GisSnapshot } from '@/data/gis';

const { mockZoomTo, mockEaseTo, mockGetZoom, mockFitBounds } = jest.requireMock(
  '@maplibre/maplibre-react-native',
);

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
});

const detailId = `${layer.layerId}/trail-1`;
function detailSnapshot(): GisSnapshot {
  return {
    layers: [layer],
    featureLayers: new Map([[detailId, layer]]),
    collection: {
      ...collection,
      features: [
        {
          ...collection.features[0],
          id: detailId,
          properties: { name: 'Selected trail', description_html: '<p>Follow the creek.</p>' },
        },
      ],
    },
    bounds: null,
    isDemo: true,
  };
}
async function pressFeature(id = detailId) {
  await fireEvent(screen.getByTestId('public-gis-source'), 'press', {
    nativeEvent: { features: [{ id, properties: { name: 'Untrusted native title' } }] },
    stopPropagation: jest.fn(),
  });
}

test('opens current GIS details without requesting GPS and dismisses back to map controls', async () => {
  const gis = jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot: detailSnapshot(), retry: jest.fn() });
  try {
    await render(<PreserveMap />);
    await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
    await pressFeature('device-location');
    expect(screen.queryByText('Feature details')).not.toBeOnTheScreen();
    await pressFeature();
    expect(screen.getByRole('header', { name: 'Selected trail' })).toBeOnTheScreen();
    expect(screen.getByText('Follow the creek.')).toBeOnTheScreen();
    expect(screen.queryByText('Untrusted native title')).not.toBeOnTheScreen();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    await userEvent.setup().press(screen.getByRole('button', { name: 'Close feature details' }));
    expect(screen.queryByText('Feature details')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    await pressFeature();
    expect(screen.getByText('Feature details')).toBeOnTheScreen();
  } finally {
    gis.mockRestore();
  }
});

test('closes selection on snapshot replacement, API failure and Map blur', async () => {
  const initial = detailSnapshot();
  const gis = jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot: initial, retry: jest.fn() });
  const { mockFocusState } = jest.requireMock('expo-router');
  try {
    const view = await render(<PreserveMap />);
    await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
    await pressFeature();
    gis.mockReturnValue({ status: 'ready', snapshot: detailSnapshot(), retry: jest.fn() });
    await view.rerender(<PreserveMap />);
    expect(screen.queryByText('Feature details')).not.toBeOnTheScreen();
    await pressFeature();
    mockFocusState.focused = false;
    await view.rerender(<PreserveMap />);
    expect(screen.queryByText('Feature details')).not.toBeOnTheScreen();
    mockFocusState.focused = true;
    await view.rerender(<PreserveMap />);
    await pressFeature();
    gis.mockReturnValue({ status: 'error', retry: jest.fn() });
    await view.rerender(<PreserveMap />);
    expect(screen.queryByText('Feature details')).not.toBeOnTheScreen();
  } finally {
    mockFocusState.focused = true;
    gis.mockRestore();
  }
});

test('selection preserves a live GPS watcher and camera position', async () => {
  const gis = jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot: detailSnapshot(), retry: jest.fn() });
  let update!: Location.LocationCallback;
  jest.mocked(Location.watchPositionAsync).mockImplementationOnce(async (_options, callback) => {
    update = callback;
    return { remove: jest.fn() };
  });
  try {
    await render(<PreserveMap />);
    await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
    await userEvent.setup().press(screen.getByRole('button', { name: 'Use my location' }));
    await waitFor(() => expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1));
    await act(() =>
      update({
        timestamp: Date.now(),
        coords: {
          latitude: 33.72,
          longitude: -84.48,
          accuracy: 5,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
      }),
    );
    const cameraCalls = mockEaseTo.mock.calls.length;
    await pressFeature();
    await userEvent.setup().press(screen.getByRole('button', { name: 'Close feature details' }));
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
    expect(mockEaseTo).toHaveBeenCalledTimes(cameraCalls);
    expect(screen.getByRole('button', { name: 'Recenter on my location' })).toBeEnabled();
  } finally {
    gis.mockRestore();
  }
});

test('refits the loaded route after measuring the legend panel without refitting unchanged layouts', async () => {
  const gis = jest.spyOn(PublicGis, 'usePublicGis').mockReturnValue({
    status: 'ready',
    retry: jest.fn(),
    snapshot: {
      layers: [layer],
      featureLayers: new Map(),
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
      featureLayers: new Map(),
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
    // Disclaimers now live in the Disclaimers tab, not inline on the map.
    expect(
      screen.queryByText('Approximate trail names · Partial network. Check park signs.'),
    ).not.toBeOnTheScreen();
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
    featureLayers: new Map(),
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
    expect(screen.queryByText('Trail colors')).not.toBeOnTheScreen();
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
