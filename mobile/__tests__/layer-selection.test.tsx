import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';

import PreserveMap from '@/components/preserve-map';
import { LayerSelectionScreen } from '@/components/layer-selection-screen';
import { MapGisProvider } from '@/hooks/map-gis-context';
import * as PublicGis from '@/hooks/use-public-gis';
import { layersSnapshot } from './fixtures/layers';

const { mockFitBounds, mockEaseTo } = jest.requireMock('@maplibre/maplibre-react-native');
const tree = (chooser = true) => (
  <MapGisProvider>
    <PreserveMap />
    {chooser && <LayerSelectionScreen />}
  </MapGisProvider>
);
beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

test('draft switches apply only on Done, update counts/details/legend and retain the camera', async () => {
  const snapshot = layersSnapshot();
  const retry = jest.fn();
  jest.spyOn(PublicGis, 'usePublicGis').mockReturnValue({ status: 'ready', snapshot, retry });
  await render(tree());
  await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
  const fitCalls = mockFitBounds.mock.calls.length;
  expect(screen.getByText('Environmental')).toBeOnTheScreen();
  await fireEvent(
    screen.getByRole('switch', { name: 'Show Preserve trails' }),
    'valueChange',
    false,
  );
  expect(screen.getByText('2 of 3 layers selected')).toBeOnTheScreen();
  expect(screen.getByLabelText('Terrace Trail: Purple')).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Apply GIS layers' }));
  expect(router.back).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Trail colors')).not.toBeOnTheScreen();
  expect(screen.getByText('Public GIS · 2 layers · 2 features')).toBeOnTheScreen();
  await fireEvent(screen.getByTestId('public-gis-source'), 'press', {
    nativeEvent: { features: [{ id: 'trails/0' }] },
    stopPropagation: jest.fn(),
  });
  expect(screen.queryByText('Feature details')).not.toBeOnTheScreen();
  await fireEvent(screen.getByText('Pan or pinch to explore').parent!, 'layout', {
    nativeEvent: { layout: { height: 260 } },
  });
  expect(mockFitBounds).toHaveBeenCalledTimes(fitCalls);
  expect(mockEaseTo).not.toHaveBeenCalled();
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(retry).not.toHaveBeenCalled();
});

test('Back cancels edits, Done survives reopen and all-off keeps browsing available', async () => {
  const snapshot = layersSnapshot();
  jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot, retry: jest.fn() });
  const view = await render(tree());
  await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
  await fireEvent(screen.getByRole('switch', { name: 'Show Landmarks' }), 'valueChange', false);
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Back to Map without applying layers' }));
  await view.rerender(tree(false));
  await view.rerender(tree());
  expect(screen.getByRole('switch', { name: 'Show Landmarks' })).toBeChecked();
  for (const name of ['Preserve trails', 'Landmarks', 'Preserve outline']) {
    await fireEvent(screen.getByRole('switch', { name: `Show ${name}` }), 'valueChange', false);
  }
  await userEvent.setup().press(screen.getByRole('button', { name: 'Apply GIS layers' }));
  await view.rerender(tree(false));
  expect(
    screen.getByText('All GIS layers are hidden. Basemap browsing remains available.'),
  ).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
  await view.rerender(tree());
  expect(screen.getByRole('switch', { name: 'Show Preserve trails' })).not.toBeChecked();
  await fireEvent(
    screen.getByRole('switch', { name: 'Show Preserve trails' }),
    'valueChange',
    true,
  );
  await userEvent.setup().press(screen.getByRole('button', { name: 'Apply GIS layers' }));
  expect(screen.getAllByLabelText('Terrace Trail: Purple')).toHaveLength(1);
  expect(screen.getByText('Public GIS · 1 layer · 1 feature')).toBeOnTheScreen();
});

test('catalog replacement discards obsolete drafts and a direct link has a safe Map return', async () => {
  const snapshot = layersSnapshot();
  const gis = jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot, retry: jest.fn() });
  const view = await render(tree());
  await fireEvent(screen.getByRole('switch', { name: 'Show Landmarks' }), 'valueChange', false);
  gis.mockReturnValue({
    status: 'ready',
    snapshot: { ...snapshot, layers: [snapshot.layers[1]] },
    retry: jest.fn(),
  });
  await view.rerender(tree());
  expect(screen.getByRole('switch', { name: 'Show Landmarks' })).toBeChecked();
  expect(screen.queryByRole('switch', { name: 'Show Preserve trails' })).not.toBeOnTheScreen();
  jest.mocked(router.canGoBack).mockReturnValueOnce(false);
  await userEvent.setup().press(screen.getByRole('button', { name: 'Apply GIS layers' }));
  expect(router.replace).toHaveBeenCalledWith('/');
});

test('unavailable catalog cannot overwrite choices and offers retry without a GPS request', async () => {
  const retry = jest.fn();
  jest.spyOn(PublicGis, 'usePublicGis').mockReturnValue({ status: 'error', retry });
  await render(tree());
  expect(screen.getByRole('button', { name: 'Apply GIS layers' })).toBeDisabled();
  expect(screen.queryByRole('switch')).not.toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Retry GIS layer choices' }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

test('trail strokes stay above ground overlays and landmark markers stay above routes', async () => {
  jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot: layersSnapshot(), retry: jest.fn() });
  await render(tree(false));
  const source = screen.getByTestId('public-gis-source');
  const layers = source.children.filter((child) => typeof child !== 'string');
  const ids = layers.map((child) => child.props.id);
  expect(ids.indexOf('gis-landmarks')).toBeGreaterThan(ids.indexOf('gis-trails'));
  expect(ids.indexOf('gis-trails')).toBeGreaterThan(ids.indexOf('gis-boundary-outline'));
  expect(ids.indexOf('gis-trail-names')).toBeGreaterThan(ids.indexOf('gis-trails'));
});

test('an empty public catalog is distinct from hiding available layers', async () => {
  const snapshot = layersSnapshot();
  jest.spyOn(PublicGis, 'usePublicGis').mockReturnValue({
    status: 'empty',
    snapshot: {
      ...snapshot,
      layers: [],
      collection: { type: 'FeatureCollection', features: [] },
      featureLayers: new Map(),
      bounds: null,
    },
    retry: jest.fn(),
  });
  await render(tree());
  expect(screen.getByText('No public GIS layers available.')).toBeOnTheScreen();
  expect(screen.getByText('No public GIS features available.')).toBeOnTheScreen();
  expect(
    screen.queryByText('All GIS layers are hidden. Basemap browsing remains available.'),
  ).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Choose GIS layers' })).toBeEnabled();
});
