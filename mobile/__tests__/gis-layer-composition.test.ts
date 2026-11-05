import type { FeatureCollection, Layer } from '../../backend/src/modules/gis/types';

import { collection, layer } from './fixtures/gis';

import { loadPublicGis } from '@/data/gis';

const landmarkLayer: Layer = {
  ...layer,
  layerId: 'public-landmarks',
  name: 'Test landmarks',
  layerType: 'landmark',
  isDemo: false,
  featuresUrl: '/api/v1/layers/public-landmarks/features',
};
// Intentionally reuse the trail's local feature ID in a different layer.
const landmarks: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      ...collection.features[0],
      properties: { name: 'Test landmark' },
      geometry: { type: 'Point', coordinates: [-84.476, 33.723] },
    },
  ],
};
const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
const mockFetch = jest.fn();
const originalFetch = globalThis.fetch;
const api = 'https://api.example/api/v1';

beforeEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = mockFetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('starts both layers before the slow one finishes and keeps identities tied to catalog order', async () => {
  let finishTrails!: (value: ReturnType<typeof response>) => void;
  const slowTrails = new Promise<ReturnType<typeof response>>((resolve) => {
    finishTrails = resolve;
  });
  let startedLandmarks!: () => void;
  const landmarksStarted = new Promise<void>((resolve) => {
    startedLandmarks = resolve;
  });
  mockFetch
    .mockResolvedValueOnce(response({ layers: [layer, landmarkLayer] }))
    .mockReturnValueOnce(slowTrails)
    .mockImplementationOnce(() => {
      startedLandmarks();
      return Promise.resolve(response(landmarks));
    });
  const signal = new AbortController().signal;
  const pending = loadPublicGis(api, signal);
  // Resolves only when the second request starts while the first is still pending.
  // This checks concurrency without inventing a device-speed threshold.
  await landmarksStarted;
  finishTrails(response(collection));
  const snapshot = await pending;

  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
    `${api}/layers`,
    `${api}/layers/demo-trails/features`,
    `${api}/layers/public-landmarks/features`,
  ]);
  expect(mockFetch.mock.calls.every(([, options]) => options.signal === signal)).toBe(true);
  const ids = snapshot.collection.features.map((feature) => feature.id);
  expect(ids).toEqual(['demo-trails/trail-1', 'public-landmarks/trail-1']);
  expect(new Set(ids).size).toBe(2);
  expect(snapshot.featureLayers.get(ids[0])).toEqual(layer);
  expect(snapshot.featureLayers.get(ids[1])).toEqual(landmarkLayer);
  expect(snapshot.featureLayers.size).toBe(2);
  expect(snapshot.collection.features.map((feature) => feature.geometry.type)).toEqual([
    'LineString',
    'Point',
  ]);
  expect(snapshot.bounds).toEqual([-84.48, 33.72, -84.476, 33.723]);
  expect(snapshot.isDemo).toBe(true);
  expect(collection.features[0].id).toBe('trail-1');
  expect(landmarks.features[0].id).toBe('trail-1');
});

test('an empty layer stays in the catalog without adding phantom features or bounds', async () => {
  mockFetch
    .mockResolvedValueOnce(response({ layers: [layer, landmarkLayer] }))
    .mockResolvedValueOnce(response(empty))
    .mockResolvedValueOnce(response(landmarks));
  const snapshot = await loadPublicGis(api, new AbortController().signal);
  expect(mockFetch).toHaveBeenCalledTimes(3);
  expect(snapshot.layers).toEqual([layer, landmarkLayer]);
  expect(snapshot.collection.features.map((feature) => feature.id)).toEqual([
    'public-landmarks/trail-1',
  ]);
  expect([...snapshot.featureLayers.keys()]).toEqual(['public-landmarks/trail-1']);
  expect(snapshot.featureLayers.get('public-landmarks/trail-1')).toEqual(landmarkLayer);
  expect(snapshot.bounds).toEqual([-84.476, 33.723, -84.476, 33.723]);
});

test('duplicate catalog rows are rejected before repeated feature requests can start', async () => {
  mockFetch.mockResolvedValueOnce(response({ layers: [layer, landmarkLayer, layer] }));
  await expect(loadPublicGis(api, new AbortController().signal)).rejects.toThrow(
    'Invalid layer metadata',
  );
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('duplicate features in one layer reject the combined snapshot even when another layer is valid', async () => {
  mockFetch
    .mockResolvedValueOnce(response({ layers: [layer, landmarkLayer] }))
    .mockResolvedValueOnce(response(collection))
    .mockResolvedValueOnce(
      response({ ...landmarks, features: [...landmarks.features, ...landmarks.features] }),
    );
  await expect(loadPublicGis(api, new AbortController().signal)).rejects.toThrow(
    'Invalid GIS feature',
  );
  expect(mockFetch).toHaveBeenCalledTimes(3);
});

test('one failed layer prevents a successful sibling from becoming a partial snapshot', async () => {
  mockFetch
    .mockResolvedValueOnce(response({ layers: [layer, landmarkLayer] }))
    .mockResolvedValueOnce(response(collection))
    .mockResolvedValueOnce(response({}, false));
  await expect(loadPublicGis(api, new AbortController().signal)).rejects.toThrow(
    'GIS request failed',
  );
  expect(mockFetch).toHaveBeenCalledTimes(3);
});
