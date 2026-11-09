import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import * as Location from 'expo-location';

import PreserveMap from '@/components/preserve-map';
import { LayerSelectionScreen } from '@/components/layer-selection-screen';
import type { GisSnapshot } from '@/data/gis';
import { MapGisProvider } from '@/hooks/map-gis-context';
import { layersSnapshot } from './fixtures/layers';

const { mockFitBounds, mockEaseTo } = jest.requireMock('@maplibre/maplibre-react-native');

test('all layer combinations survive repeated apply/reopen cycles through the real GIS client without refetching', async () => {
  const oldUrl = process.env.EXPO_PUBLIC_API_URL;
  const oldFetch = globalThis.fetch;
  process.env.EXPO_PUBLIC_API_URL = 'https://gis.example/api/v1';
  jest.clearAllMocks();

  const fixture = layersSnapshot();
  const layers = fixture.layers.map((layer) => ({
    ...layer,
    featuresUrl: `/api/v1/layers/${layer.layerId}/features`,
  }));
  // Repeated raw IDs across layers must retain separate identities; two sections
  // of one trail must render separately while sharing just one legend entry.
  const collections = layers.map((_, index) => ({
    type: 'FeatureCollection',
    features: [
      { ...fixture.collection.features[index], id: 'shared' },
      ...(index === 0 ? [{ ...fixture.collection.features[0], id: 'return' }] : []),
    ],
  }));
  const payloads = new Map<string, unknown>([
    ['https://gis.example/api/v1/layers', { layers }],
    ...layers.map((layer, index): [string, unknown] => [
      `https://gis.example${layer.featuresUrl}`,
      collections[index],
    ]),
  ]);
  const before = JSON.stringify([...payloads]);
  const fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!payloads.has(url)) throw new Error('Unexpected GIS request');
    return { ok: true, json: async () => payloads.get(url) } as Response;
  });
  globalThis.fetch = fetch;
  const tree = (chooser: boolean) => (
    <MapGisProvider>
      <PreserveMap />
      {chooser && <LayerSelectionScreen />}
    </MapGisProvider>
  );

  try {
    const view = await render(tree(false));
    expect(await screen.findByText('Public GIS · 3 layers · 4 features')).toBeOnTheScreen();
    await fireEvent(screen.getByTestId('preserve-map'), 'didFinishRenderingMapFully');
    const fits = mockFitBounds.mock.calls.length;
    const moves = mockEaseTo.mock.calls.length;
    const user = userEvent.setup();

    // Exercise every subset, then the reverse order to catch accumulated state.
    for (const mask of [0, 1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 0, 7]) {
      await view.rerender(tree(true));
      for (const [index, layer] of layers.entries()) {
        await fireEvent(
          screen.getByRole('switch', { name: `Show ${layer.name}` }),
          'valueChange',
          Boolean(mask & (1 << index)),
        );
      }
      await user.press(screen.getByRole('button', { name: 'Apply GIS layers' }));
      await view.rerender(tree(false));

      const expectedIds = [
        ...(mask & 1 ? ['trails/shared', 'trails/return'] : []),
        ...(mask & 2 ? ['landmarks/shared'] : []),
        ...(mask & 4 ? ['boundary/shared'] : []),
      ];
      if (expectedIds.length) {
        const data = screen.getByTestId('public-gis-source').props
          .data as GisSnapshot['collection'];
        expect(data.features.map((feature) => feature.id)).toEqual(expectedIds);
        expect(new Set(data.features.map((feature) => feature.id)).size).toBe(expectedIds.length);
      } else {
        expect(screen.queryByTestId('public-gis-source')).not.toBeOnTheScreen();
        expect(
          screen.getByText('All GIS layers are hidden. Basemap browsing remains available.'),
        ).toBeOnTheScreen();
      }
      expect(screen.queryAllByLabelText('Terrace Trail: Purple')).toHaveLength(mask & 1 ? 1 : 0);

      for (const [index, layer] of layers.entries()) {
        if (!expectedIds.length) break;
        await fireEvent(screen.getByTestId('public-gis-source'), 'press', {
          nativeEvent: { features: [{ id: `${layer.layerId}/shared` }] },
          stopPropagation: jest.fn(),
        });
        if (mask & (1 << index)) {
          expect(
            screen.getByRole('header', {
              name: String(fixture.collection.features[index].properties.name),
            }),
          ).toBeOnTheScreen();
          await user.press(screen.getByRole('button', { name: 'Close feature details' }));
        } else {
          expect(screen.queryByText('Feature details')).not.toBeOnTheScreen();
        }
      }

      expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
      await view.rerender(tree(true));
      for (const [index, layer] of layers.entries()) {
        const toggle = screen.getByRole('switch', { name: `Show ${layer.name}` });
        if (mask & (1 << index)) expect(toggle).toBeChecked();
        else expect(toggle).not.toBeChecked();
      }
      await view.rerender(tree(false));
      expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual([...payloads.keys()].sort());
      expect(mockFitBounds).toHaveBeenCalledTimes(fits);
      expect(mockEaseTo).toHaveBeenCalledTimes(moves);
    }

    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    expect(JSON.stringify([...payloads])).toBe(before);
    await view.unmount();
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = oldUrl;
  }
}, 15000);
