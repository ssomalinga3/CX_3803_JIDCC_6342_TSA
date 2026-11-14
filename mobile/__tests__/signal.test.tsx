import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import NativePreserveMap from '@/components/preserve-map';
import { LayerSelectionScreen } from '@/components/layer-selection-screen';
import { featureDetails, pressedFeatureId } from '@/data/feature-details';
import { loadPublicGis, type GisSnapshot } from '@/data/gis';
import { signalClasses, signalLayerId } from '@/data/signal';
import { trailPresentation } from '@/data/trail-presentation';
import { MapGisProvider } from '@/hooks/map-gis-context';
import * as PublicGis from '@/hooks/use-public-gis';
const { readFileSync } = jest.requireActual<{ readFileSync: (p: string, e: string) => string }>(
  'node:fs',
);
const observations = JSON.parse(readFileSync('../data/cascade-springs-gis/signal.geojson', 'utf8'));
const trails = JSON.parse(readFileSync('../data/cascade-springs-gis/trails.geojson', 'utf8'));
const landmarks = JSON.parse(
  readFileSync('../data/cascade-springs-gis/pdf-map.geojson', 'utf8'),
).features.filter((f: { geometry: { type: string } }) => f.geometry.type === 'Point');
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});
async function snapshot(data = observations): Promise<GisSnapshot> {
  const definitions = [
    { id: signalLayerId, name: 'Cell-signal observations', kind: 'cell_signal', data },
    { id: 'trails', name: 'Trails', kind: 'trail', data: trails },
    {
      id: 'landmarks',
      name: 'Landmarks',
      kind: 'landmark',
      data: { type: 'FeatureCollection', features: landmarks },
    },
  ];
  const layers = definitions.map((d) => ({
    layerId: d.id,
    name: d.name,
    layerType: d.kind,
    description: '',
    source: 'Supplied source',
    pillar: null,
    isDemo: false,
    featuresUrl: `/api/v1/layers/${d.id}/features`,
  }));
  globalThis.fetch = jest.fn().mockImplementation(async (input: string) => ({
    ok: true,
    json: async () =>
      input.endsWith('/layers')
        ? { layers }
        : definitions.find((d) => input.includes(`/layers/${d.id}/`))!.data,
  }));
  return loadPublicGis('https://example.com/api/v1', new AbortController().signal);
}
test('source classes and pixels appear in details without invented units, while POIs retain hit priority', async () => {
  const data = await snapshot();
  expect(data.collection.features).toHaveLength(735);
  expect(trailPresentation(data.collection).legend).toHaveLength(10);
  const sample = data.collection.features.find(
    (f) => f.properties.feature_kind === 'signal_observation',
  )!;
  const details = featureDetails(data, sample.id)!;
  expect(details.fields).toContainEqual({
    label: 'Signal class',
    value: sample.properties.signal_class,
  });
  expect(details.fields).toContainEqual({
    label: 'Source pixel',
    value: (sample.properties.source_pixel as number[]).join(', '),
  });
  expect(details.fields.find((f) => f.label === 'Positioning')?.value).toContain('uncertain');
  expect(JSON.stringify(details)).not.toMatch(/dBm|carrier|survey date/);
  const poi = data.collection.features.find(
    (f) => f.geometry.type === 'Point' && f.properties.feature_kind !== 'signal_observation',
  )!;
  expect(pressedFeatureId(data, [{ id: sample.id }, { id: poi.id }])).toBe(poi.id);
});
test.each([
  'missing',
  'class',
  'units',
  'source',
  'pixel',
  'version',
  'geometry',
  'range',
  'dimension',
])('rejects %s instead of silently displaying wrong signal classes', async (kind) => {
  const value = structuredClone(observations);
  const f = value.features[0];
  if (kind === 'missing') value.features.pop();
  if (kind === 'class') f.properties.signal_class = 'strong';
  if (kind === 'units') f.properties.units = 'dBm';
  if (kind === 'source') f.properties.source_sha256 = 'old';
  if (kind === 'pixel') f.properties.source_pixel = [-1, 0];
  if (kind === 'version') f.properties.extraction_version = 2;
  if (kind === 'range') f.geometry = { type: 'Point', coordinates: [0, 0] };
  if (kind === 'dimension') f.geometry.coordinates.push(0);
  if (kind === 'geometry')
    f.geometry = {
      type: 'LineString',
      coordinates: [
        [-84.48, 33.717],
        [-84.48, 33.718],
      ],
    };
  await expect(snapshot(value)).rejects.toThrow(/signal/i);
});
test('signal toggles apply with Done, keep the camera, avoid duplicate points and retain location controls', async () => {
  const data = await snapshot();
  jest
    .spyOn(PublicGis, 'usePublicGis')
    .mockReturnValue({ status: 'ready', snapshot: data, retry: jest.fn() });
  const { mockFitBounds } = jest.requireMock('@maplibre/maplibre-react-native');
  await render(
    <MapGisProvider>
      <NativePreserveMap />
      <LayerSelectionScreen />
    </MapGisProvider>,
  );
  await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
  const fits = mockFitBounds.mock.calls.length;
  expect(screen.getByText('Public GIS · 2 layers · 58 features')).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('radio', { name: 'Use Researcher preset' }));
  await userEvent.setup().press(screen.getByRole('button', { name: 'Apply GIS layers' }));
  expect(screen.getByText('Public GIS · 3 layers · 735 features')).toBeOnTheScreen();
  for (const c of signalClasses)
    expect(screen.getByLabelText(`${c.label}: ${c.color_name}`)).toBeOnTheScreen();
  await fireEvent(
    screen.getByRole('switch', { name: 'Show Cell-signal observations' }),
    'valueChange',
    false,
  );
  expect(screen.getByText('Cell-signal classes')).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Apply GIS layers' }));
  expect(screen.queryByText('Cell-signal classes')).not.toBeOnTheScreen();
  expect(screen.getByText('Public GIS · 2 layers · 58 features')).toBeOnTheScreen();
  expect(mockFitBounds).toHaveBeenCalledTimes(fits);
  expect(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled();
  await fireEvent(
    screen.getByRole('switch', { name: 'Show Cell-signal observations' }),
    'valueChange',
    true,
  );
  await userEvent.setup().press(screen.getByRole('button', { name: 'Apply GIS layers' }));
  expect(screen.getByText('Public GIS · 3 layers · 735 features')).toBeOnTheScreen();
  expect(screen.getAllByText('Cell-signal classes')).toHaveLength(1);
  expect(mockFitBounds).toHaveBeenCalledTimes(fits);
});
