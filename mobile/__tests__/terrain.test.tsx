import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import NativePreserveMap from '@/components/preserve-map';
import { LayerSelectionScreen } from '@/components/layer-selection-screen';
import { featureDetails, pressedFeatureId } from '@/data/feature-details';
import { loadPublicGis, type GisSnapshot } from '@/data/gis';
import { visibleGis } from '@/data/layer-visibility';
import { trailPresentation } from '@/data/trail-presentation';
import { MapGisProvider } from '@/hooks/map-gis-context';
import * as PublicGis from '@/hooks/use-public-gis';
const { readFileSync } = jest.requireActual<{
  readFileSync: (path: string, encoding: string) => string;
}>('node:fs');
const terrain = JSON.parse(readFileSync('../data/cascade-springs-gis/terrain.geojson', 'utf8'));
const trails = JSON.parse(readFileSync('../data/cascade-springs-gis/trails.geojson', 'utf8'));
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});
async function snapshot(data = terrain): Promise<GisSnapshot> {
  const layers = ['supplied', 'usgs'].map((key) => ({
    layerId: `cascade-terrain-${key}`,
    name: `Elevation ${key}`,
    layerType: 'terrain',
    description: '',
    source:
      key === 'supplied'
        ? 'Supplied DTM; horizontal datum unknown'
        : 'USGS 3DEP; resampled service subset',
    pillar: null,
    isDemo: false,
    featuresUrl: `/api/v1/layers/cascade-terrain-${key}/features`,
  }));
  layers.push({
    layerId: 'trails',
    name: 'Trails',
    layerType: 'trail',
    description: '',
    source: 'Supplied',
    pillar: null,
    isDemo: false,
    featuresUrl: '/api/v1/layers/trails/features',
  });
  globalThis.fetch = jest.fn().mockImplementation(async (input: string) => ({
    ok: true,
    json: async () =>
      input.endsWith('/layers')
        ? { layers }
        : input.includes('/trails/')
          ? trails
          : {
              type: 'FeatureCollection',
              features: data.features.filter((f: { properties: { source_dataset: string } }) =>
                input.includes(
                  f.properties.source_dataset.replace('csnp-terrain-', 'cascade-terrain-'),
                ),
              ),
            },
  }));
  return loadPublicGis('https://example.com/api/v1', new AbortController().signal);
}
test('two sources retain units/details, remain separate from trails and do not capture trail hits', async () => {
  const data = await snapshot();
  expect(data.collection.features).toHaveLength(98);
  expect(trailPresentation(data.collection).legend).toHaveLength(10);
  const band = data.collection.features.find(
    (f) => f.properties.feature_kind === 'elevation_band',
  )!;
  const details = featureDetails(data, band.id)!;
  expect(details.fields).toContainEqual({
    label: 'Elevation band',
    value: `${band.properties.elevation_min_ft_us}–${band.properties.elevation_max_ft_us} ftUS`,
  });
  expect(details.fields.find((f) => f.label === 'Vertical reference')?.value).toContain('NAVD88');
  const trail = data.collection.features.find((f) => f.properties.feature_kind === 'trail')!;
  expect(pressedFeatureId(data, [{ id: band.id }, { id: trail.id }])).toBe(trail.id);
  expect(visibleGis(data, new Set(['cascade-terrain-supplied'])).collection.features).toHaveLength(
    69,
  );
});
test.each(['version', 'hash', 'placement', 'missing-image', 'units', 'url-source'])(
  'rejects %s instead of displaying mismatched or incomplete terrain',
  async (kind) => {
    const value = structuredClone(terrain);
    const image = value.features[0];
    if (kind === 'version') image.properties.dataset_version = 'old';
    if (kind === 'hash') image.properties.raster_sha256 = 'old';
    if (kind === 'placement') image.geometry.coordinates[0][1][0] += 0.0001;
    if (kind === 'missing-image') value.features.shift();
    if (kind === 'units') value.features[1].properties.elevation_min_ft_us = '800';
    if (kind === 'url-source') image.properties.source_dataset = 'remote';
    await expect(snapshot(value)).rejects.toThrow(/Terrain|terrain/);
  },
);
const tree = (chooser = true) => (
  <MapGisProvider>
    <NativePreserveMap />
    {chooser && <LayerSelectionScreen />}
  </MapGisProvider>
);
test('one Elevation toggle selects one source, applies drafts on Done and preserves the camera', async () => {
  const data = await snapshot();
  jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot: data, retry: jest.fn() });
  const { mockFitBounds } = jest.requireMock('@maplibre/maplibre-react-native');
  await render(tree());
  await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
  const fits = mockFitBounds.mock.calls.length;
  expect(screen.queryByTestId('terrain-supplied')).not.toBeOnTheScreen();
  expect(screen.getByTestId('terrain-usgs')).toBeOnTheScreen();
  expect(screen.getAllByRole('switch')).toHaveLength(2);
  expect(screen.getByText('2 of 2 layers selected')).toBeOnTheScreen();
  expect(screen.queryByText('Why they look similar')).not.toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Choose elevation source' }));
  expect(screen.getByText('Why they look similar')).toBeOnTheScreen();
  expect(
    screen.getByText(/90% of height differences were within about 13 inches/),
  ).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: 'Use USGS 3DEP elevation' })).toBeChecked();
  await userEvent.setup().press(screen.getByRole('radio', { name: 'Use Supplied DTM elevation' }));
  expect(screen.getByTestId('terrain-usgs')).toBeOnTheScreen();
  expect(screen.queryByTestId('terrain-supplied')).not.toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Apply GIS layers' }));
  expect(screen.getByTestId('terrain-supplied')).toBeOnTheScreen();
  expect(screen.queryByTestId('terrain-usgs')).not.toBeOnTheScreen();
  expect(screen.getByText('Public GIS · 2 layers · 65 features')).toBeOnTheScreen();
  expect(mockFitBounds).toHaveBeenCalledTimes(fits);
  expect(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled();
  await fireEvent(screen.getByRole('switch', { name: 'Show Elevation' }), 'valueChange', false);
  await userEvent.setup().press(screen.getByRole('button', { name: 'Apply GIS layers' }));
  expect(screen.queryByTestId('terrain-usgs')).not.toBeOnTheScreen();
  expect(screen.queryByTestId('terrain-supplied')).not.toBeOnTheScreen();
  expect(screen.getByText('Public GIS · 1 layer · 36 features')).toBeOnTheScreen();
  await fireEvent(screen.getByRole('switch', { name: 'Show Elevation' }), 'valueChange', true);
  await userEvent.setup().press(screen.getByRole('button', { name: 'Apply GIS layers' }));
  expect(screen.getAllByTestId('terrain-supplied')).toHaveLength(1);
  expect(screen.queryByTestId('terrain-usgs')).not.toBeOnTheScreen();
  expect(mockFitBounds).toHaveBeenCalledTimes(fits);
});

test('Back cancels a source change and a disabled Elevation remembers its chosen source', async () => {
  const data = await snapshot();
  jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot: data, retry: jest.fn() });
  const view = await render(tree());
  await userEvent.setup().press(screen.getByRole('button', { name: 'Choose elevation source' }));
  await userEvent.setup().press(screen.getByRole('radio', { name: 'Use Supplied DTM elevation' }));
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Back to Map without applying layers' }));
  await view.rerender(tree(false));
  await view.rerender(tree());
  expect(screen.getByText('Source: USGS 3DEP')).toBeOnTheScreen();
  await fireEvent(screen.getByRole('switch', { name: 'Show Elevation' }), 'valueChange', false);
  await userEvent.setup().press(screen.getByRole('button', { name: 'Choose elevation source' }));
  await userEvent.setup().press(screen.getByRole('radio', { name: 'Use Supplied DTM elevation' }));
  await userEvent.setup().press(screen.getByRole('button', { name: 'Apply GIS layers' }));
  await view.rerender(tree(false));
  await view.rerender(tree());
  expect(screen.getByText('Source: Supplied DTM')).toBeOnTheScreen();
  expect(screen.getByRole('switch', { name: 'Show Elevation' })).not.toBeChecked();
  expect(screen.queryByTestId('terrain-supplied')).not.toBeOnTheScreen();
  await fireEvent(screen.getByRole('switch', { name: 'Show Elevation' }), 'valueChange', true);
  await userEvent.setup().press(screen.getByRole('button', { name: 'Apply GIS layers' }));
  expect(screen.getByTestId('terrain-supplied')).toBeOnTheScreen();
  expect(screen.queryByTestId('terrain-usgs')).not.toBeOnTheScreen();
});

test('refresh retains the chosen source and safely falls back when it is no longer public', async () => {
  const data = await snapshot();
  const gis = jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot: data, retry: jest.fn() });
  const view = await render(tree());
  await userEvent.setup().press(screen.getByRole('button', { name: 'Choose elevation source' }));
  await userEvent.setup().press(screen.getByRole('radio', { name: 'Use Supplied DTM elevation' }));
  await userEvent.setup().press(screen.getByRole('button', { name: 'Apply GIS layers' }));
  gis.mockReturnValue({ status: 'ready', snapshot: { ...data }, retry: jest.fn() });
  await view.rerender(tree());
  expect(screen.getByTestId('terrain-supplied')).toBeOnTheScreen();
  expect(screen.queryByTestId('terrain-usgs')).not.toBeOnTheScreen();
  gis.mockReturnValue({
    status: 'ready',
    snapshot: visibleGis(data, new Set(['cascade-terrain-supplied'])),
    retry: jest.fn(),
  });
  await view.rerender(tree());
  expect(screen.getByTestId('terrain-usgs')).toBeOnTheScreen();
  expect(screen.getByText('Source: USGS 3DEP')).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Choose elevation source' }));
  expect(screen.queryByRole('radio', { name: 'Use Supplied DTM elevation' })).not.toBeOnTheScreen();
});
