import { act, fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import NativePreserveMap from '@/components/preserve-map';
import { LayerSelectionScreen } from '@/components/layer-selection-screen';
import { checkBasemap } from '@/data/basemap-health';
import { basemaps, DEFAULT_BASEMAP, getBasemap, unavailableBasemap } from '@/data/basemaps';
import { MapGisProvider } from '@/hooks/map-gis-context';
import * as PublicGis from '@/hooks/use-public-gis';
import { collection, layer } from './fixtures/gis';

const health = jest.mocked(checkBasemap);
const { mockFitBounds, mockEaseTo } = jest.requireMock('@maplibre/maplibre-react-native');
const tree = (chooser = true) => (
  <MapGisProvider>
    <NativePreserveMap />
    {chooser && <LayerSelectionScreen />}
  </MapGisProvider>
);
async function choose(label: string) {
  const button = screen.getByRole('button', { name: 'Choose base map' });
  if (!button.props.accessibilityState.expanded) await userEvent.setup().press(button);
  await userEvent.setup().press(screen.getByRole('radio', { name: `Use ${label} base map` }));
}
async function rendered() {
  await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  health.mockResolvedValue(undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

test('keyless catalog is unique, defaults safely and keeps raster axis order and glyph support', () => {
  expect(new Set(basemaps.map((b) => b.id)).size).toBe(basemaps.length);
  expect(getBasemap('unknown').id).toBe(DEFAULT_BASEMAP);
  expect(basemaps).toHaveLength(9);
  for (const entry of basemaps) {
    expect(entry.attribution).toBeTruthy();
    if (typeof entry.style === 'string')
      expect(entry.style).toMatch(/^https:\/\/tiles.openfreemap.org\/styles\//);
    else {
      expect(entry.style.glyphs).toMatch(/\{fontstack\}.*\{range\}/);
      expect(entry.style.sources.basemap).toEqual(
        expect.objectContaining({
          type: 'raster',
          tileSize: 256,
          maxzoom: 16,
          tiles: [expect.stringContaining('/tile/{z}/{y}/{x}')],
        }),
      );
    }
  }
});

test.each(['unconfigured', 'loading', 'error', 'empty'] as const)(
  'chooses every style without GIS when status is %s and retains choices after leaving',
  async (status) => {
    const retry = jest.fn();
    jest.spyOn(PublicGis, 'usePublicGis').mockReturnValue(
      status === 'empty'
        ? {
            status,
            retry,
            snapshot: {
              layers: [],
              featureLayers: new Map(),
              collection: { type: 'FeatureCollection', features: [] },
              bounds: null,
              isDemo: false,
            },
          }
        : { status, retry },
    );
    const view = await render(tree());
    for (const entry of basemaps) {
      await choose(`${entry.provider} ${entry.name}`);
      expect(screen.getByRole('button', { name: 'Choose base map' })).toBeExpanded();
      expect(
        screen.getByRole('radio', { name: `Use ${entry.provider} ${entry.name} base map` }),
      ).toBeChecked();
      expect(screen.getByTestId('preserve-map')).toHaveProp('mapStyle', entry.style);
      await rendered();
    }
    await userEvent.setup().press(screen.getByRole('button', { name: 'Choose base map' }));
    expect(screen.getByRole('button', { name: 'Choose base map' })).toBeCollapsed();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    await userEvent.setup().press(screen.getByRole('button', { name: 'Choose base map' }));
    expect(screen.getByRole('radio', { name: 'Use USGS Shaded Relief base map' })).toBeChecked();
    await view.rerender(tree(false));
    await view.rerender(tree());
    expect(screen.getByRole('button', { name: 'Choose base map' })).toHaveAccessibilityValue({
      text: 'USGS · Shaded Relief',
    });
    expect(screen.getByRole('button', { name: 'Done choosing GIS layers' })).toBeEnabled();
    expect(retry).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    await view.unmount();
    await render(tree());
    expect(screen.getByTestId('preserve-map')).toHaveProp(
      'mapStyle',
      getBasemap(DEFAULT_BASEMAP).style,
    );
  },
);

test('switching preserves the map instance, zoomed camera, counts and GIS choices', async () => {
  const retry = jest.fn();
  const data = {
    layers: [layer],
    featureLayers: new Map(),
    collection,
    bounds: [-84.48, 33.72, -84.47, 33.73] as [number, number, number, number],
    isDemo: false,
  };
  const gis = jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot: data, retry });
  await render(tree());
  await rendered();
  const nativeMap = screen.getByTestId('preserve-map');
  const fits = mockFitBounds.mock.calls.length;
  const moves = mockEaseTo.mock.calls.length;
  await choose('USGS Aerial');
  await rendered();
  expect(screen.getByTestId('preserve-map')).toBe(nativeMap);
  expect(screen.getByText('Public GIS · 1 layer · 1 feature')).toBeOnTheScreen();
  await fireEvent(screen.getByText('Pan or pinch to explore').parent!, 'layout', {
    nativeEvent: { layout: { height: 390 } },
  });
  expect(mockFitBounds).toHaveBeenCalledTimes(fits);
  expect(mockEaseTo).toHaveBeenCalledTimes(moves);
  gis.mockReturnValue({ status: 'error', retry });
  // API failure and restoration cannot erase the independent style selection.
  await choose('OpenFreeMap Dark');
  await rendered();
  expect(screen.getByTestId('preserve-map')).toHaveProp(
    'mapStyle',
    getBasemap('openfreemap-dark').style,
  );
  expect(retry).not.toHaveBeenCalled();
  expect(Location.watchPositionAsync).not.toHaveBeenCalled();
});

test('resource rejection wins over native blank-map success, stops provider traffic and recovers explicitly', async () => {
  await render(tree());
  await rendered();
  health.mockRejectedValueOnce(new Error('HTTP 429'));
  await choose('USGS Aerial');
  await rendered();
  expect(screen.getByTestId('preserve-map')).toHaveProp('mapStyle', unavailableBasemap);
  expect(screen.getByRole('button', { name: 'Use Standard map' })).toBeOnTheScreen();
  const count = health.mock.calls.length;
  await userEvent.setup().press(screen.getByRole('button', { name: 'Retry loading map' }));
  expect(health).toHaveBeenCalledTimes(count + 1);
  await rendered();
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
  await fireEvent(screen.getByTestId('preserve-map'), 'didFailLoadingMap');
  await userEvent.setup().press(screen.getByRole('button', { name: 'Use Standard map' }));
  await rendered();
  expect(screen.getByTestId('preserve-map')).toHaveProp(
    'mapStyle',
    getBasemap(DEFAULT_BASEMAP).style,
  );
});

test('obsolete health requests and native handlers cannot complete or fail the new attempt', async () => {
  let rejectOld!: (reason: Error) => void;
  health.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectOld = reject;
      }),
  );
  await render(tree());
  const oldFinished = screen.getByTestId('preserve-map').props.onDidFinishRenderingMapFully;
  const oldFailed = screen.getByTestId('preserve-map').props.onDidFailLoadingMap;
  const signal = health.mock.calls[0][2];
  await choose('OpenFreeMap Dark');
  expect(signal.aborted).toBe(true);
  await act(async () => {
    oldFinished();
    oldFailed();
    rejectOld(new Error('old failure'));
  });
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  await rendered();
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Retry loading map' })).not.toBeOnTheScreen();
});

test('silent tile failure times out once and never automatically retries', async () => {
  jest.useFakeTimers();
  try {
    health.mockImplementationOnce(() => new Promise(() => {}));
    await render(tree());
    await rendered();
    await act(async () => {
      jest.advanceTimersByTime(20000);
    });
    expect(screen.getByRole('button', { name: 'Retry loading map' })).toBeOnTheScreen();
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(health).toHaveBeenCalledTimes(1);
    expect(health.mock.calls[0][2].aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test('a live GPS session survives style switching and retry without another prompt or watcher', async () => {
  const remove = jest.fn();
  jest.mocked(Location.watchPositionAsync).mockResolvedValueOnce({ remove });
  await render(tree());
  await rendered();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Use my location' }));
  await waitFor(() => expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1));
  const prompts = jest.mocked(Location.requestForegroundPermissionsAsync).mock.calls.length;
  await choose('USGS Aerial');
  await rendered();
  await fireEvent(screen.getByTestId('preserve-map'), 'didFailLoadingMap');
  await userEvent.setup().press(screen.getByRole('button', { name: 'Retry loading map' }));
  await rendered();
  expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(prompts);
  expect(remove).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Turn off map location' })).toBeOnTheScreen();
});
