import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import NativePreserveMap from '@/components/preserve-map';
import { LayerSelectionScreen } from '@/components/layer-selection-screen';
import { pressedFeatureId } from '@/data/feature-details';
import type { GisSnapshot } from '@/data/gis';
import { gisLayerOrder } from '@/data/map-layer-order';
import { MapGisProvider } from '@/hooks/map-gis-context';
import * as PublicGis from '@/hooks/use-public-gis';
import * as MapLocation from '@/hooks/use-map-location';
import { layersSnapshot, publicLayers } from './fixtures/layers';
const { readFileSync } = jest.requireActual<{ readFileSync: (p: string, e: string) => string }>(
  'node:fs',
);
const terrain: GisSnapshot['collection'] = JSON.parse(
  readFileSync('../data/cascade-springs-gis/terrain.geojson', 'utf8'),
);
afterEach(() => jest.restoreAllMocks());

function withTerrain(): GisSnapshot {
  const snapshot = layersSnapshot();
  const layers = ['supplied', 'usgs'].map((key) => ({
    ...publicLayers[0],
    layerId: `cascade-terrain-${key}`,
    name: `Elevation ${key}`,
    layerType: 'terrain',
  }));
  const features = terrain.features.map((f) => ({
    ...f,
    id: `cascade-terrain-${String(f.properties.source_dataset).replace('csnp-terrain-', '')}/${f.id}`,
  }));
  return {
    ...snapshot,
    layers: [...snapshot.layers, ...layers],
    collection: {
      type: 'FeatureCollection',
      features: [...snapshot.collection.features, ...features],
    },
    featureLayers: new Map([
      ...snapshot.featureLayers,
      ...features.map(
        (f) => [f.id, layers.find((l) => f.id.startsWith(`${l.layerId}/`))!] as const,
      ),
    ]),
  };
}
function renderedLayers() {
  return screen
    .getByTestId('public-gis-source')
    .children.filter((child) => typeof child !== 'string');
}
const tree = (
  <MapGisProvider>
    <NativePreserveMap />
    <LayerSelectionScreen />
  </MapGisProvider>
);

test('ground fills cannot cover trails/markers and labels stay above geometry', async () => {
  jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot: withTerrain(), retry: jest.fn() });
  await render(tree);
  const rendered = renderedLayers();
  const ids = rendered.map((l) => l.props.id);
  // Validate actual native props, including every predecessor, rather than catalog order.
  expect(ids).toEqual([...gisLayerOrder]);
  rendered.forEach((l, i) => expect(l.props.afterId).toBe(ids[i - 1]));
  for (const lower of [
    'gis-elevation-bands',
    'gis-natural-areas',
    'gis-water',
    'gis-roads',
    'gis-buildings',
    'gis-boundary-outline',
    'gis-signal-samples',
  ]) {
    expect(ids.indexOf(lower)).toBeLessThan(ids.indexOf('gis-trail-casing'));
  }
  expect(ids.indexOf('gis-landmarks')).toBeGreaterThan(ids.indexOf('gis-unnamed-connections'));
  expect(ids.indexOf('gis-elevation-labels')).toBeGreaterThan(ids.indexOf('gis-landmarks'));
  expect(ids.indexOf('gis-trail-names')).toBeGreaterThan(ids.indexOf('gis-elevation-labels'));
});

test('raster slots survive hide/show and all-hidden while retaining the camera', async () => {
  jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot: withTerrain(), retry: jest.fn() });
  const { mockFitBounds } = jest.requireMock('@maplibre/maplibre-react-native');
  await render(tree);
  await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
  const fits = mockFitBounds.mock.calls.length;
  const anchors = () => renderedLayers().filter((l) => l.props.id.endsWith('-anchor'));
  const before = anchors();
  expect(before).toHaveLength(2);
  for (const a of before) {
    expect(a.props.filter).toEqual([
      'all',
      ['has', '__gis_order_anchor'],
      ['!', ['has', '__gis_order_anchor']],
    ]);
    expect(a.props.paint['fill-opacity']).toBe(0);
  }
  const applyDraft = async () => {
    const done = screen.queryByRole('button', { name: 'Apply GIS layers' });
    if (done) await userEvent.setup().press(done);
  };
  await fireEvent(screen.getByRole('switch', { name: 'Show Elevation' }), 'valueChange', false);
  for (const name of ['Preserve trails', 'Landmarks', 'Preserve outline'])
    await fireEvent(screen.getByRole('switch', { name: `Show ${name}` }), 'valueChange', false);
  await applyDraft();
  expect(screen.getByTestId('public-gis-source').props.data.features).toEqual([]);
  expect(anchors()).toHaveLength(2);
  await fireEvent(screen.getByRole('switch', { name: 'Show Elevation' }), 'valueChange', true);
  await userEvent.setup().press(screen.getByRole('button', { name: 'Choose elevation source' }));
  for (const key of ['usgs', 'supplied'] as const) {
    const label = key === 'usgs' ? 'USGS 3DEP' : 'Supplied DTM';
    await userEvent.setup().press(screen.getByRole('radio', { name: `Use ${label} elevation` }));
    await applyDraft();
    expect(
      screen.queryByTestId(`terrain-${key === 'usgs' ? 'supplied' : 'usgs'}`),
    ).not.toBeOnTheScreen();
    const image = screen.getByTestId(`terrain-${key}`);
    const layer = image.children.find((c) => typeof c !== 'string')!;
    if (typeof layer === 'string') throw new Error('Missing raster layer');
    expect(layer.props.beforeId).toBe(
      key === 'supplied' ? 'gis-terrain-usgs-anchor' : 'gis-elevation-bands',
    );
    expect(renderedLayers().some((l) => l.props.id === layer.props.beforeId)).toBe(true);
  }
  expect(mockFitBounds).toHaveBeenCalledTimes(fits);
});

test('device position stays above GIS even when no catalog is available', async () => {
  jest.spyOn(PublicGis, 'usePublicGis').mockReturnValue({ status: 'error', retry: jest.fn() });
  jest.spyOn(MapLocation, 'useMapLocation').mockReturnValue({
    status: 'ready',
    fix: {
      timestamp: 0,
      coords: {
        longitude: 0,
        latitude: 0,
        altitude: null,
        altitudeAccuracy: null,
        accuracy: 5,
        heading: null,
        speed: null,
      },
    },
    enable: jest.fn(),
    disable: jest.fn(),
  });
  await render(tree);
  expect(screen.getByTestId('public-gis-source').props.data.features).toEqual([]);
  const mapChildren = screen
    .getByTestId('preserve-map')
    .children.filter((c) => typeof c !== 'string');
  const device = mapChildren.find((c) => c.props.id === 'device-location')!;
  const dot = device.children.find((c) => typeof c !== 'string');
  if (!dot || typeof dot === 'string') throw new Error('Missing device position');
  expect(dot.props.afterId).toBe('gis-landmark-names');
  expect(renderedLayers().some((l) => l.props.id === dot.props.afterId)).toBe(true);
});

test('crowded taps prefer visible landmark markers, then trail strokes, then signal samples', () => {
  const snapshot = layersSnapshot();
  snapshot.collection.features.push({
    type: 'Feature',
    id: 'signal/0',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { feature_kind: 'signal_observation' },
  });
  expect(pressedFeatureId(snapshot, [{ id: 'signal/0' }, { id: 'trails/0' }])).toBe('trails/0');
  expect(
    pressedFeatureId(snapshot, [{ id: 'signal/0' }, { id: 'trails/0' }, { id: 'landmarks/1' }]),
  ).toBe('landmarks/1');
});
