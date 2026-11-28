import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { useState } from 'react';

import { TerrainMap } from '@/components/terrain-map';
import PreserveMap from '@/components/preserve-map';
import { LayerSelectionScreen } from '@/components/layer-selection-screen';
import { assembleGisSnapshot } from '@/data/gis';
import { terrainDocument } from '@/data/terrain-3d-html';
import * as TerrainHtml from '@/data/terrain-3d-html';
import { getBasemap, DEFAULT_BASEMAP } from '@/data/basemaps';
import {
  elevation,
  initialTerrainView,
  insideTerrain,
  parseTerrainMessage,
  terrainTrails,
} from '@/data/terrain-3d';
import { MapGisProvider } from '@/hooks/map-gis-context';
import * as PublicGis from '@/hooks/use-public-gis';
import * as MapHeading from '@/hooks/use-map-heading';
import * as MapLocation from '@/hooks/use-map-location';
import * as OffTrail from '@/hooks/use-off-trail';
import { collection, layer } from './fixtures/gis';
import { suppliedSnapshot } from './fixtures/supplied-gis';

const { mockInjectJavaScript } = jest.requireMock('react-native-webview');
const snapshot = () =>
  assembleGisSnapshot(
    [layer],
    [
      {
        ...collection,
        features: [
          {
            ...collection.features[0],
            geometry: {
              type: 'LineString',
              coordinates: [
                [-84.48, 33.717],
                [-84.478, 33.718],
              ],
            },
            properties: {
              feature_kind: 'trail',
              trail_id: 'springs',
              name: '</script><script>alert(1)</script>',
              description: 'private metadata',
            },
          },
        ],
      },
    ],
  );
const presentation = terrainTrails(snapshot());
function Standalone({ fix }: { fix?: Location.LocationObject }) {
  const [view, setView] = useState(initialTerrainView);
  return (
    <TerrainMap
      trails={presentation}
      basemap={getBasemap(DEFAULT_BASEMAP)}
      fix={fix}
      view={view}
      onViewChange={setView}
      onStatus={onStatus}
      onGesture={onGesture}
      onReturnTo2d={onReturnTo2d}
      onRetryTrails={jest.fn()}
    />
  );
}
const onStatus = jest.fn(),
  onGesture = jest.fn(),
  onReturnTo2d = jest.fn();
const fix: Location.LocationObject = {
  coords: {
    latitude: 33.717,
    longitude: -84.479,
    altitude: null,
    accuracy: 5,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
  },
  timestamp: Date.now(),
};
async function ready() {
  const session = currentSession();
  await fireEvent(screen.getByTestId('terrain-webview'), 'message', {
    nativeEvent: {
      data: JSON.stringify({ version: 1, session, type: 'ready', startupMs: 200 }),
    },
  });
}
function currentSession() {
  return JSON.parse(
    screen.getByTestId('terrain-webview').props.source.html.match(/session=("[^"]+")/)[1],
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
});

test('only covered trail geometry and allowlisted styles enter the document', () => {
  const data = snapshot();
  data.collection.features.push(
    { ...data.collection.features[0], id: 'road', properties: { feature_kind: 'road' } },
    {
      ...data.collection.features[0],
      id: 'outside',
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    },
  );
  data.featureLayers = new Map([
    ...data.featureLayers,
    ['road', { ...layer, layerType: 'context' }],
    ['outside', layer],
  ]);
  const trails = terrainTrails(data);
  expect(trails.collection.features).toHaveLength(1);
  expect(trails.collection.features[0].properties).toEqual({
    _display_trail_color: '#C95700',
    _display_trail_casing: '#FFFFFF',
    _display_trail_dashed: false,
  });
  const html = terrainDocument(trails.collection, 'safe');
  expect(html).not.toContain('private metadata');
  expect(html).not.toContain('alert(1)');
  expect(html).toContain('connect-src data: blob:');
  expect(html).toContain('exaggeration:1');
  expect(html).toContain("id:'device-position'");
});

test('validates bridge sessions, numeric bounds and event types', () => {
  const message = { version: 1, session: 'current', type: 'ready', startupMs: 200 };
  expect(parseTerrainMessage(JSON.stringify(message), 'current')).toEqual(message);
  expect(
    parseTerrainMessage(
      JSON.stringify({ ...message, type: 'camera', view: initialTerrainView }),
      'current',
    )?.type,
  ).toBe('camera');
  for (const raw of [
    'invalid',
    'null',
    'x'.repeat(257),
    JSON.stringify({ ...message, session: 'old' }),
    JSON.stringify({ ...message, startupMs: 15001 }),
    JSON.stringify({ ...message, type: 'camera', view: { ...initialTerrainView, center: [0, 0] } }),
    JSON.stringify({ ...message, type: 'navigate' }),
  ]) {
    expect(parseTerrainMessage(raw, 'current')).toBeUndefined();
  }
});

test('choosing 2D restores every original GIS setting with the full supplied catalog', async () => {
  const retry = jest.fn();
  const gis = jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot: suppliedSnapshot(), retry });
  try {
    await render(
      <MapGisProvider>
        <LayerSelectionScreen />
      </MapGisProvider>,
    );
    const originalNames = screen
      .getAllByRole('switch')
      .map((item) => item.props.accessibilityLabel);
    expect(originalNames).toHaveLength(9);
    await fireEvent(
      screen.getByRole('switch', { name: 'Show Cell-signal observations' }),
      'valueChange',
      true,
    );
    await fireEvent(screen.getByRole('switch', { name: 'Show Elevation' }), 'valueChange', true);
    await userEvent.setup().press(screen.getByRole('button', { name: 'Choose base map' }));
    await userEvent.setup().press(screen.getByRole('button', { name: 'Choose elevation source' }));
    await userEvent.setup().press(screen.getByRole('radio', { name: 'Use 3D terrain map' }));
    expect(screen.getAllByRole('switch')).toHaveLength(9);
    for (const control of screen.getAllByRole('switch')) expect(control).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose base map' })).toBeEnabled();
    await userEvent.setup().press(screen.getByRole('radio', { name: 'Use USGS Aerial base map' }));
    expect(screen.getByRole('button', { name: 'Choose elevation source' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Use Staff preset' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Use Supplied DTM elevation' })).toBeDisabled();
    await userEvent.setup().press(screen.getByRole('radio', { name: 'Use Staff preset' }));
    await userEvent
      .setup()
      .press(screen.getByRole('radio', { name: 'Use Supplied DTM elevation' }));
    expect(screen.getByRole('radio', { name: 'Use 2D map' })).toBeEnabled();
    await userEvent.setup().press(screen.getByRole('radio', { name: 'Use 2D map' }));
    expect(screen.getAllByRole('switch').map((item) => item.props.accessibilityLabel)).toEqual(
      originalNames,
    );
    expect(screen.getByRole('switch', { name: 'Show Cell-signal observations' })).toHaveProp(
      'value',
      true,
    );
    expect(screen.getByRole('switch', { name: 'Show Elevation' })).toHaveProp('value', true);
    expect(screen.getByRole('button', { name: 'Choose base map' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Choose base map' })).toHaveAccessibilityValue({
      text: 'USGS · Aerial',
    });
    expect(screen.getByRole('button', { name: 'Choose elevation source' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Use USGS 3DEP elevation' })).toBeChecked();
    for (const control of screen.getAllByRole('switch')) expect(control).toBeEnabled();
    expect(screen.getAllByRole('radio', { name: /preset$/ })).toHaveLength(3);
    expect(retry).not.toHaveBeenCalled();
  } finally {
    gis.mockRestore();
  }
});

test('clips crossing trails at DEM edges and keeps disconnected covered portions separate', () => {
  const data = snapshot();
  const [west, south, east, north] = elevation.bounds;
  const middle = (south + north) / 2;
  data.collection.features[0].geometry = {
    type: 'LineString',
    coordinates: [
      [west - 0.001, middle],
      [east + 0.001, middle],
      [east + 0.001, middle + 0.0001],
      [west - 0.001, middle + 0.0001],
    ],
  };
  const result = terrainTrails(data).collection.features[0].geometry;
  expect(result.type).toBe('MultiLineString');
  if (result.type !== 'MultiLineString') throw new Error('Expected clipped line parts');
  expect(result.coordinates).toHaveLength(2);
  for (const line of result.coordinates)
    for (const point of line) expect(insideTerrain(point)).toBe(true);
  expect(result.coordinates[0][0][0]).toBeCloseTo(west, 10);
  expect(result.coordinates[0][1][0]).toBeCloseTo(east, 10);
});

test('repeated 2D/3D transitions retain hidden layers, basemap and camera without a GIS reload', async () => {
  const data = snapshot(),
    retry = jest.fn();
  const gis = jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot: data, retry });
  try {
    await render(
      <MapGisProvider>
        <PreserveMap />
        <LayerSelectionScreen />
      </MapGisProvider>,
    );
    await fireEvent(
      screen.getByRole('switch', { name: 'Show Synthetic demo trails' }),
      'valueChange',
      false,
    );
    const style = screen.getByTestId('preserve-map').props.mapStyle;
    const nativeView = {
      center: [-84.478, 33.718],
      zoom: 17.1,
      bearing: 20,
      pitch: 10,
      bounds: [0, 0, 0, 0],
      userInteraction: true,
    };
    await fireEvent(screen.getByTestId('preserve-map'), 'regionDidChange', {
      nativeEvent: nativeView,
    });
    for (let i = 0; i < 4; i++) {
      await userEvent.setup().press(screen.getByRole('radio', { name: 'Use 3D terrain map' }));
      await ready();
      expect(screen.getByRole('button', { name: 'Follow my location' })).toBeEnabled();
      await userEvent.setup().press(screen.getByRole('radio', { name: 'Use 2D map' }));
      await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
      expect(screen.getByTestId('public-gis-source').props.data.features).toHaveLength(0);
      expect(screen.getByRole('switch', { name: 'Show Synthetic demo trails' })).toHaveProp(
        'value',
        false,
      );
      expect(screen.getByTestId('preserve-map').props.mapStyle).toBe(style);
      expect(
        jest.requireMock('@maplibre/maplibre-react-native').mockInitialView,
      ).toHaveBeenLastCalledWith({ center: nativeView.center, zoom: 17.1, bearing: 20, pitch: 10 });
    }
    await fireEvent(
      screen.getByRole('switch', { name: 'Show Synthetic demo trails' }),
      'valueChange',
      true,
    );
    expect(screen.getByTestId('public-gis-source').props.data.features).toHaveLength(1);
    expect(retry).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  } finally {
    gis.mockRestore();
  }
});

test('3D transitions retain reporting and off-trail controls and restore the 2D compass', async () => {
  const gis = jest.spyOn(PublicGis, 'usePublicGis').mockReturnValue({
    status: 'ready',
    snapshot: snapshot(),
    retry: jest.fn(),
  });
  const location = jest.spyOn(MapLocation, 'useMapLocation').mockReturnValue({
    status: 'ready',
    fix,
    enable: jest.fn(),
    disable: jest.fn(),
  });
  const heading = jest
    .spyOn(MapHeading, 'useMapHeading')
    .mockImplementation((enabled) => (enabled ? 45 : undefined));
  const offTrail = jest.spyOn(OffTrail, 'useOffTrail').mockReturnValue({
    status: 'off-trail',
    showWarning: true,
    dismiss: jest.fn(),
    hideForever: jest.fn(),
  });
  try {
    await render(
      <MapGisProvider>
        <PreserveMap />
        <LayerSelectionScreen />
      </MapGisProvider>,
    );
    const compass = () => screen.getByTestId('device-heading-source');
    expect(compass()).toBeVisible();
    const firstCone = compass().props.data;
    await fireEvent(screen.getByTestId('preserve-map'), 'regionDidChange', {
      nativeEvent: {
        center: initialTerrainView.center,
        zoom: 18,
        bearing: 0,
        pitch: 0,
        bounds: [0, 0, 0, 0],
      },
    });
    expect(compass().props.data).not.toEqual(firstCone);
    await userEvent.setup().press(screen.getByRole('radio', { name: 'Use 3D terrain map' }));
    await ready();
    expect(heading).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('button', { name: 'Report an issue' })).toBeEnabled();
    expect(screen.getByTestId('off-trail-status')).toBeOnTheScreen();
    expect(screen.getByTestId('off-trail-warning')).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole('radio', { name: 'Use 2D map' }));
    expect(heading).toHaveBeenLastCalledWith(true);
    expect(compass()).toBeVisible();
    expect(screen.getByRole('button', { name: 'Report an issue' })).toBeEnabled();
  } finally {
    gis.mockRestore();
    location.mockRestore();
    heading.mockRestore();
    offTrail.mockRestore();
  }
});

test('settings replace Map in place and restore camera and GIS into a fresh native surface', async () => {
  const gis = jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot: snapshot(), retry: jest.fn() });
  const tree = (chooser: boolean) => (
    <MapGisProvider>
      <PreserveMap />
      {chooser && <LayerSelectionScreen />}
    </MapGisProvider>
  );
  try {
    const view = await render(tree(true));
    const nativeMap = screen.getByTestId('preserve-map');
    const nativeView = {
      center: [-84.478, 33.718],
      zoom: 17.3,
      bearing: 42,
      pitch: 15,
      bounds: [0, 0, 0, 0],
    };
    await fireEvent(nativeMap, 'regionDidChange', {
      nativeEvent: { ...nativeView, userInteraction: true },
    });
    expect(
      screen.queryByRole('button', { name: 'View 3D terrain and trails' }),
    ).not.toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole('radio', { name: 'Use 3D terrain map' }));
    await view.rerender(tree(false));
    await ready();
    expect(screen.getByTestId('preserve-map', { includeHiddenElements: true })).toBe(nativeMap);
    expect(screen.getByText('3D terrain and trails · True scale')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Follow my location' })).toBeEnabled();
    await view.rerender(tree(true));
    await userEvent.setup().press(screen.getByRole('radio', { name: 'Use 2D map' }));
    expect(screen.queryByTestId('terrain-webview')).not.toBeOnTheScreen();
    expect(screen.getByTestId('preserve-map')).not.toBe(nativeMap);
    const { mockInitialView } = jest.requireMock('@maplibre/maplibre-react-native');
    expect(mockInitialView).toHaveBeenLastCalledWith({
      center: nativeView.center,
      zoom: 17.3,
      bearing: 42,
      pitch: 15,
    });
    expect(screen.getByTestId('public-gis-source').props.data.features).toHaveLength(1);
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  } finally {
    gis.mockRestore();
  }
});

test('position updates stay on device, clear when disabled, and gestures stop follow', async () => {
  const view = await render(<Standalone fix={fix} />);
  await ready();
  expect(mockInjectJavaScript).toHaveBeenLastCalledWith(
    expect.stringContaining('window.cascade3d?.position([-84.479,33.717])'),
  );
  await view.rerender(<Standalone />);
  expect(mockInjectJavaScript).toHaveBeenLastCalledWith(expect.stringContaining('position(null)'));
  await fireEvent(screen.getByTestId('terrain-webview'), 'message', {
    nativeEvent: {
      data: JSON.stringify({ version: 1, session: currentSession(), type: 'gesture' }),
    },
  });
  expect(onGesture).toHaveBeenCalledTimes(1);
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

test('renderer failure offers explicit retry and return to 2D', async () => {
  await render(<Standalone />);
  const web = screen.getByTestId('terrain-webview');
  expect(web.props.onShouldStartLoadWithRequest({ url: 'https://example.com' })).toBe(false);
  await fireEvent(web, 'renderProcessGone');
  expect(screen.queryByTestId('terrain-webview')).not.toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Retry 3D' }));
  expect(currentSession().endsWith('-1')).toBe(true);
});

test('background and blur release WebView, foreground recreates it', async () => {
  let onChange: (state: AppStateStatus) => void = () => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    onChange = listener;
    return { remove: jest.fn() };
  });
  const { mockFocusState } = jest.requireMock('expo-router');
  const document = jest.spyOn(TerrainHtml, 'terrainDocument');
  mockFocusState.focused = false;
  const view = await render(<Standalone />);
  expect(document).not.toHaveBeenCalled();
  expect(screen.queryByTestId('terrain-webview')).not.toBeOnTheScreen();
  mockFocusState.focused = true;
  await view.rerender(<Standalone />);
  expect(screen.getByTestId('terrain-webview')).toBeOnTheScreen();
  await act(() => onChange('background'));
  expect(screen.queryByTestId('terrain-webview')).not.toBeOnTheScreen();
  expect(mockInjectJavaScript).toHaveBeenLastCalledWith('window.cascade3d?.dispose();true;');
  await act(() => onChange('active'));
  expect(screen.getByTestId('terrain-webview')).toBeOnTheScreen();
  const session = currentSession();
  // Android can batch background/resume updates before committing a native
  // unmount; the already-disposed browser must still get a new instance.
  await act(() => {
    onChange('background');
    onChange('active');
  });
  expect(currentSession()).not.toBe(session);
  mockFocusState.focused = false;
  await view.rerender(<Standalone />);
  expect(screen.queryByTestId('terrain-webview')).not.toBeOnTheScreen();
  await view.unmount();
  mockFocusState.focused = true;
  document.mockRestore();
});
