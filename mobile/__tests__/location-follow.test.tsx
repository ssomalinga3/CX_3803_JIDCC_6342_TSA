import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import type { LocationObject } from 'expo-location';

import PreserveMap from '@/components/preserve-map';
import { MapGisProvider } from '@/hooks/map-gis-context';
import { useMapLocation } from '@/hooks/use-map-location';

jest.mock('@/hooks/use-map-location');
const { mockEaseTo, mockGetZoom, mockZoomTo } = jest.requireMock('@maplibre/maplibre-react-native');
const { mockFocusState } = jest.requireMock('expo-router');
const location = jest.mocked(useMapLocation);
const enable = jest.fn();
const disable = jest.fn();
function fix(longitude = -84.48): LocationObject {
  return {
    timestamp: Date.now(),
    coords: {
      longitude,
      latitude: 33.72,
      accuracy: 5,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
  };
}
function setFix(value: LocationObject | undefined) {
  location.mockReturnValue({ status: value ? 'ready' : 'stale', fix: value, enable, disable });
}
function MapScreen() {
  return (
    <MapGisProvider>
      <PreserveMap />
    </MapGisProvider>
  );
}
const recenter = () => screen.getByRole('button', { name: 'Recenter on my location' });
async function readyMap() {
  const view = await render(<MapScreen />);
  await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
  mockEaseTo.mockClear();
  return view;
}
async function region(userInteraction: boolean, event = 'regionWillChange') {
  await fireEvent(screen.getByTestId('preserve-map'), event, { nativeEvent: { userInteraction } });
}
beforeEach(() => {
  jest.clearAllMocks();
  mockGetZoom.mockReset().mockResolvedValue(16);
  mockFocusState.focused = true;
  setFix(fix());
});
afterEach(() => {
  mockFocusState.focused = true;
});

test.each([13, 15.5, 18.5])(
  'recenter at zoom %s only zooms in and selects follow mode',
  async (zoom) => {
    mockGetZoom.mockResolvedValue(zoom);
    await readyMap();
    expect(mockEaseTo).not.toHaveBeenCalled();
    await userEvent.setup().press(recenter());
    expect(mockEaseTo).toHaveBeenLastCalledWith(
      expect.objectContaining({
        center: [-84.48, 33.72],
        zoom: Math.max(15.5, zoom),
        padding: expect.objectContaining({ top: 169, bottom: expect.any(Number) }),
      }),
    );
    expect(recenter()).toBeSelected();
  },
);

test('fresh fixes keep the requested zoom; programmatic camera and zoom buttons keep following', async () => {
  const view = await readyMap();
  await userEvent.setup().press(recenter());
  await region(false);
  await region(false, 'regionIsChanging');
  await userEvent.setup().press(screen.getByRole('button', { name: 'Zoom in' }));
  expect(mockZoomTo).not.toHaveBeenCalled();
  expect(mockEaseTo).toHaveBeenLastCalledWith({
    center: [-84.48, 33.72],
    zoom: 17,
    padding: expect.any(Object),
    duration: 200,
  });
  mockEaseTo.mockClear();
  for (const longitude of [-84.481, -84.482]) {
    setFix(fix(longitude));
    await view.rerender(<MapScreen />);
    expect(mockEaseTo).toHaveBeenLastCalledWith({
      center: [longitude, 33.72],
      zoom: 17,
      padding: expect.any(Object),
      duration: 300,
    });
  }
  expect(recenter()).toBeSelected();
});

test.each([
  ['Zoom in', 17],
  ['Zoom out', 15],
] as const)(
  '%s keeps stationary GPS centered without waiting for a new fix',
  async (label, zoom) => {
    await readyMap();
    await userEvent.setup().press(recenter());
    mockEaseTo.mockClear();
    await userEvent.setup().press(screen.getByRole('button', { name: label }));
    expect(mockEaseTo).toHaveBeenCalledTimes(1);
    expect(mockEaseTo).toHaveBeenLastCalledWith({
      center: [-84.48, 33.72],
      zoom,
      padding: expect.any(Object),
      duration: 200,
    });
    expect(mockZoomTo).not.toHaveBeenCalled();
    expect(recenter()).toBeSelected();
  },
);

test('successive zoom taps build on the requested scale during native animation and respect the limit', async () => {
  const view = await readyMap();
  await userEvent.setup().press(recenter());
  const user = userEvent.setup();
  // Native getZoom still reports 16 while the earlier animation is in progress.
  for (const zoom of [17, 18, 19, 19]) {
    await user.press(screen.getByRole('button', { name: 'Zoom in' }));
    expect(mockEaseTo).toHaveBeenLastCalledWith(expect.objectContaining({ zoom }));
  }
  setFix(fix(-84.481));
  await view.rerender(<MapScreen />);
  expect(mockEaseTo).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 19 }));
});

test('zoom after dragging browses the viewport without pulling it back to GPS', async () => {
  await readyMap();
  await userEvent.setup().press(recenter());
  await region(true);
  mockEaseTo.mockClear();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Zoom in' }));
  expect(mockEaseTo).not.toHaveBeenCalled();
  expect(mockZoomTo).toHaveBeenCalledWith(17, { duration: 200 });
});

test('dragging cancels pending zoom rather than snapping back to GPS when its query resolves', async () => {
  await readyMap();
  await userEvent.setup().press(recenter());
  let resolve!: (zoom: number) => void;
  mockGetZoom.mockReturnValueOnce(
    new Promise<number>((done) => {
      resolve = done;
    }),
  );
  await userEvent.setup().press(screen.getByRole('button', { name: 'Zoom in' }));
  await region(true);
  mockEaseTo.mockClear();
  await act(async () => resolve(16));
  expect(mockEaseTo).not.toHaveBeenCalled();
  expect(mockZoomTo).not.toHaveBeenCalled();
});

test.each(['regionWillChange', 'regionIsChanging'])(
  '%s gesture stops following immediately until recenter is tapped again',
  async (event) => {
    const view = await readyMap();
    await userEvent.setup().press(recenter());
    await region(true, event);
    expect(recenter()).not.toBeSelected();
    mockEaseTo.mockClear();
    setFix(fix(-84.481));
    await view.rerender(<MapScreen />);
    expect(mockEaseTo).not.toHaveBeenCalled();
    expect(screen.getByText('Your location is shown in blue')).toBeOnTheScreen();
    await userEvent.setup().press(recenter());
    expect(mockEaseTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ center: [-84.481, 33.72] }),
    );
    expect(recenter()).toBeSelected();
  },
);

test('return to preserve stops following', async () => {
  const view = await readyMap();
  await userEvent.setup().press(recenter());
  await userEvent.setup().press(screen.getByRole('button', { name: 'Return to preserve' }));
  expect(recenter()).not.toBeSelected();
  mockEaseTo.mockClear();
  setFix(fix(-84.481));
  await view.rerender(<MapScreen />);
  expect(mockEaseTo).not.toHaveBeenCalled();
});

test('lost/stale/disabled location and blur cancel follow; recovery needs another recenter tap', async () => {
  const view = await readyMap();
  await userEvent.setup().press(recenter());
  setFix(undefined);
  await view.rerender(<MapScreen />);
  expect(recenter()).toBeDisabled();
  expect(recenter()).not.toBeSelected();
  mockEaseTo.mockClear();
  setFix(fix(-84.481));
  await view.rerender(<MapScreen />);
  expect(mockEaseTo).not.toHaveBeenCalled();
  await userEvent.setup().press(recenter());
  mockFocusState.focused = false;
  await view.rerender(<MapScreen />);
  expect(recenter()).not.toBeSelected();
  mockFocusState.focused = true;
  mockEaseTo.mockClear();
  setFix(fix(-84.482));
  await view.rerender(<MapScreen />);
  expect(mockEaseTo).not.toHaveBeenCalled();
});

test('map failure cancels follow and rendering recovery does not resume it', async () => {
  await readyMap();
  await userEvent.setup().press(recenter());
  await fireEvent(screen.getByTestId('preserve-map'), 'didFailLoadingMap');
  expect(recenter()).not.toBeSelected();
  mockEaseTo.mockClear();
  await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
  expect(mockEaseTo).not.toHaveBeenCalled();
});

test.each(['drag', 'lost fix', 'return', 'blur', 'unmount'])(
  '%s cancels a pending native zoom query',
  async (action) => {
    let resolve!: (zoom: number) => void;
    mockGetZoom.mockReturnValue(
      new Promise<number>((done) => {
        resolve = done;
      }),
    );
    const view = await readyMap();
    await userEvent.setup().press(recenter());
    if (action === 'drag') await region(true);
    if (action === 'lost fix') {
      setFix(undefined);
      await view.rerender(<MapScreen />);
    }
    if (action === 'return')
      await userEvent.setup().press(screen.getByRole('button', { name: 'Return to preserve' }));
    if (action === 'blur') {
      mockFocusState.focused = false;
      await view.rerender(<MapScreen />);
    }
    if (action === 'unmount') await view.unmount();
    mockEaseTo.mockClear();
    await act(async () => resolve(17));
    expect(mockEaseTo).not.toHaveBeenCalled();
  },
);

test('pending recenter uses the newest fix and handles rejected native queries', async () => {
  let resolve!: (zoom: number) => void;
  mockGetZoom.mockReturnValueOnce(
    new Promise<number>((done) => {
      resolve = done;
    }),
  );
  const view = await readyMap();
  await userEvent.setup().press(recenter());
  setFix(fix(-84.481));
  await view.rerender(<MapScreen />);
  await act(async () => resolve(18));
  expect(mockEaseTo).toHaveBeenLastCalledWith(
    expect.objectContaining({ center: [-84.481, 33.72], zoom: 18 }),
  );
  mockGetZoom.mockRejectedValueOnce(new Error('Map unmounted'));
  mockEaseTo.mockClear();
  await userEvent.setup().press(recenter());
  expect(mockEaseTo).not.toHaveBeenCalled();
  expect(recenter()).not.toBeSelected();
});
