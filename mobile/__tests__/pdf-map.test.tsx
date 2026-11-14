import type { FeatureCollection } from '../../backend/src/modules/gis/types';
import { router } from 'expo-router';
import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { LayerSelectionScreen } from '@/components/layer-selection-screen';
import NativePreserveMap from '@/components/preserve-map';
import { featureDetails, pressedFeatureId } from '@/data/feature-details';
import { loadPublicGis } from '@/data/gis';
import { visibleGis } from '@/data/layer-visibility';
import { trailPresentation } from '@/data/trail-presentation';
import { MapGisProvider } from '@/hooks/map-gis-context';
import * as PublicGis from '@/hooks/use-public-gis';
const { readFileSync } = jest.requireActual<{
  readFileSync: (path: string, encoding: string) => string;
}>('node:fs');
const context = JSON.parse(readFileSync('../data/cascade-springs-gis/pdf-map.geojson', 'utf8'));
const trails = JSON.parse(readFileSync('../data/cascade-springs-gis/trails.geojson', 'utf8'));
const kinds = ['trail', 'boundary', 'water', 'natural_area', 'road', 'building', 'landmark'];
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});
async function snapshot() {
  const layers = kinds.map((kind) => ({
    layerId: kind,
    name: kind,
    layerType: kind,
    description: '',
    source: 'Supplied sources',
    pillar: null,
    isDemo: false,
    featuresUrl: `/api/v1/layers/${kind}/features`,
  }));
  const mockFetch = jest.fn();
  mockFetch.mockImplementation(async (input: string) => ({
    ok: true,
    json: async () =>
      String(input).endsWith('/layers')
        ? { layers }
        : {
            type: 'FeatureCollection',
            features: [...trails.features, ...context.features].filter(
              (f) => f.properties.feature_kind === String(input).split('/').at(-2),
            ),
          },
  }));
  globalThis.fetch = mockFetch;
  return loadPublicGis('https://example.com/api/v1', new AbortController().signal);
}
test('all real PDF layers compose with supplied trails; switches remove only their assigned features', async () => {
  const data = await snapshot();
  expect(data.collection.features).toHaveLength(69);
  expect(trailPresentation(data.collection).legend).toHaveLength(10);
  for (const kind of kinds) {
    const filtered = visibleGis(data, new Set([kind]));
    expect(filtered.collection.features.every((f) => f.properties.feature_kind !== kind)).toBe(
      true,
    );
    expect(filtered.collection.features.length).toBe(
      69 - data.collection.features.filter((f) => f.properties.feature_kind === kind).length,
    );
    expect(trailPresentation(filtered.collection).legend).toHaveLength(kind === 'trail' ? 0 : 10);
  }
  const lines: FeatureCollection = {
    type: 'FeatureCollection' as const,
    features: ['water', 'road'].map((kind) => ({
      ...data.collection.features[0],
      properties: { feature_kind: kind },
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [-84.48, 33.716],
          [-84.481, 33.717],
        ],
      },
    })),
  };
  expect(trailPresentation(lines).legend).toEqual([]);
  expect(trailPresentation(lines).collection).toEqual(lines);
  const waterfall = data.collection.features.find(
    (f) => f.properties.landmark_kind === 'waterfall',
  )!;
  const details = featureDetails(data, waterfall.id)!;
  expect(details.title).toBe('Waterfall');
  expect(details.fields).toContainEqual({ label: 'Symbol type', value: 'waterfall' });
  expect(details.fields.find((f) => f.label === 'My Maps annotation')?.value).toContain(
    'View trail details',
  );
  expect(JSON.stringify(details)).not.toContain('<img');
  const spring = data.collection.features.find((f) => f.properties.source_name === 'Spring')!;
  expect(featureDetails(data, spring.id)?.title).toBe('Spring (My Maps annotation)');
  expect(
    pressedFeatureId(data, [{ id: waterfall.id }, { id: data.collection.features[0].id }]),
  ).toBe(waterfall.id);
});
test('chooser exposes all context kinds; applying water visibility preserves the mounted camera', async () => {
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
  const calls = mockFitBounds.mock.calls.length;
  await userEvent.setup().press(screen.getByRole('radio', { name: 'Use Staff preset' }));
  expect(screen.getAllByRole('switch')).toHaveLength(7);
  expect(screen.getByText('Building footprints from the supplied map.')).toBeOnTheScreen();
  await fireEvent(screen.getByRole('switch', { name: 'Show water' }), 'valueChange', false);
  expect(screen.getByText('Public GIS · 6 layers · 67 features')).toBeOnTheScreen();
  expect(mockFitBounds).toHaveBeenCalledTimes(calls);
  const source = screen.getByTestId('public-gis-source');
  expect(
    source.props.data.features.some(
      (f: { properties: { feature_kind: string } }) => f.properties.feature_kind === 'water',
    ),
  ).toBe(false);
  expect(router.back).not.toHaveBeenCalled();
});
