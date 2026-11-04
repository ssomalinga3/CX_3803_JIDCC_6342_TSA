import { collection, layer } from './fixtures/gis';

import {
  apiBaseUrl,
  collectionBounds,
  featureUrl,
  loadPublicGis,
  parseCatalog,
  parseCollection,
} from '@/data/gis';

const mockFetch = jest.fn();
const originalFetch = globalThis.fetch;
beforeEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = mockFetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });

test('loads the catalog and resolves feature URLs against the origin, preserving longitude/latitude', async () => {
  mockFetch
    .mockResolvedValueOnce(response({ layers: [layer] }))
    .mockResolvedValueOnce(response(collection));
  const signal = new AbortController().signal;
  const data = await loadPublicGis('http://localhost:8787/api/v1/', signal);
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
    'http://localhost:8787/api/v1/layers',
    'http://localhost:8787/api/v1/layers/demo-trails/features',
  ]);
  expect(mockFetch.mock.calls.every(([, options]) => options.signal === signal)).toBe(true);
  expect(data.collection.features[0].id).toBe('demo-trails/trail-1');
  expect(data.bounds).toEqual([-84.48, 33.72, -84.478, 33.722]);
  expect(data.isDemo).toBe(true);
});

test('empty catalogs and feature collections are valid empty results', async () => {
  mockFetch.mockResolvedValueOnce(response({ layers: [] }));
  expect(
    (await loadPublicGis('http://localhost:8787/api/v1', new AbortController().signal)).collection
      .features,
  ).toEqual([]);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(parseCollection({ type: 'FeatureCollection', features: [] }).features).toEqual([]);
  expect(collectionBounds({ type: 'FeatureCollection', features: [] })).toBeNull();
});

test.each([
  { layers: [layer, layer] },
  { layers: [{ ...layer, isDemo: 'true' }] },
  { layers: [{ ...layer, pillar: 1 }] },
  { layers: [{ ...layer, featuresUrl: null }] },
  [],
])('rejects malformed catalog metadata: %p', (data) => expect(() => parseCatalog(data)).toThrow());

test.each([
  { type: 'Point', coordinates: [33.72, -184.48] },
  { type: 'LineString', coordinates: [[-84.48, 33.72]] },
  { type: 'Point', coordinates: [NaN, 33.72] },
  {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    ],
  },
  { type: 'GeometryCollection', geometries: [{ type: 'Invalid' }] },
])('rejects invalid geometry before native rendering: %p', (geometry) => {
  expect(() =>
    parseCollection({ ...collection, features: [{ ...collection.features[0], geometry }] }),
  ).toThrow();
});

test('rejects duplicate IDs and non-object properties', () => {
  expect(() =>
    parseCollection({ ...collection, features: [...collection.features, ...collection.features] }),
  ).toThrow();
  expect(() =>
    parseCollection({ ...collection, features: [{ ...collection.features[0], properties: [] }] }),
  ).toThrow();
});

test.each([
  'https://other.example/api/v1/layers/demo-trails/features',
  '//other.example/api/v1/layers/demo-trails/features',
  '/api/v1/layers/another/features',
  '/api/v1/layers/demo-trails/features?secret=1',
])('rejects unexpected feature URL: %s', (url) => {
  expect(() =>
    featureUrl(apiBaseUrl('https://api.example/api/v1'), { ...layer, featuresUrl: url }),
  ).toThrow();
});

test('validates all feature URLs before starting feature requests', async () => {
  mockFetch.mockResolvedValueOnce(
    response({
      layers: [layer, { ...layer, layerId: 'bad', featuresUrl: 'https://other.example/' }],
    }),
  );
  await expect(
    loadPublicGis('https://api.example/api/v1', new AbortController().signal),
  ).rejects.toThrow();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('requires HTTPS outside development and refuses credentials or the wrong base path', () => {
  expect(() => apiBaseUrl('http://localhost:8787/api/v1', false)).toThrow();
  expect(() => apiBaseUrl('https://user:password@api.example/api/v1')).toThrow();
  expect(() => apiBaseUrl('https://api.example/api/v1/layers')).toThrow();
  expect(apiBaseUrl('https://api.example/api/v1', false).origin).toBe('https://api.example');
});

test('a failed layer response rejects the whole snapshot instead of presenting partial success', async () => {
  mockFetch
    .mockResolvedValueOnce(response({ layers: [layer] }))
    .mockResolvedValueOnce(response({}, false));
  await expect(
    loadPublicGis('https://api.example/api/v1', new AbortController().signal),
  ).rejects.toThrow('GIS request failed');
});
