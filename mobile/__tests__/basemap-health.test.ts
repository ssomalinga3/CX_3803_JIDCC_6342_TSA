import { checkBasemap, tileAt } from '@/data/basemap-health';
import { getBasemap, GLYPHS } from '@/data/basemaps';
jest.unmock('@/data/basemap-health');
const originalFetch = globalThis.fetch;
const view = { center: [-84.4792, 33.7176] as [number, number], zoom: 19 };
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function response(value = new Uint8Array([1, 2, 3]).buffer) {
  return { ok: true, arrayBuffer: async () => value };
}
test('checks the selected raster tile at its native zoom and the overlay glyph independently', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue(response());
  await checkBasemap(getBasemap('usgs-aerial'), view, new AbortController().signal);
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  const urls = jest.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
  expect(urls).toContain(
    tileAt(
      'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
      view,
      16,
    ),
  );
  expect(urls.some((url) => url.includes('Noto%20Sans%20Regular/0-255.pbf'))).toBe(true);
  expect(urls.every((url) => !url.includes('USGSTopo'))).toBe(true);
});
test.each([401, 403, 429, 500])(
  'rejects HTTP %s without leaking URLs or coordinates',
  async (status) => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status });
    await expect(
      checkBasemap(getBasemap('usgs-aerial'), view, new AbortController().signal),
    ).rejects.toThrow('Basemap resource unavailable');
  },
);
test('rejects empty tiles and missing vector sources, not just missing style JSON', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue(response(new ArrayBuffer(0)));
  await expect(
    checkBasemap(getBasemap('usgs-aerial'), view, new AbortController().signal),
  ).rejects.toThrow('empty');
  globalThis.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ version: 8, sources: {}, layers: [] }) });
  await expect(
    checkBasemap(getBasemap('openfreemap-dark'), view, new AbortController().signal),
  ).rejects.toThrow('source missing');
});
test('vector styles resolve selected tile metadata and propagate cancellation to all requests', async () => {
  const signal = new AbortController().signal;
  globalThis.fetch = jest.fn().mockImplementation(async (url) => {
    if (url === getBasemap('openfreemap-dark').style)
      return {
        ok: true,
        json: async () => ({
          version: 8,
          glyphs: GLYPHS,
          layers: [],
          sources: { vector: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
        }),
      };
    if (url === 'https://tiles.openfreemap.org/planet')
      return {
        ok: true,
        json: async () => ({
          tiles: ['https://tiles.openfreemap.org/current/{z}/{x}/{y}.pbf'],
          maxzoom: 14,
        }),
      };
    return response();
  });
  await checkBasemap(getBasemap('openfreemap-dark'), view, signal);
  expect(globalThis.fetch).toHaveBeenCalledWith(
    tileAt('https://tiles.openfreemap.org/current/{z}/{x}/{y}.pbf', view, 14),
    { signal },
  );
  expect(
    jest.mocked(globalThis.fetch).mock.calls.every(([, options]) => options?.signal === signal),
  ).toBe(true);
});

test('rejects a style without a native glyph endpoint instead of falsely validating overlay labels', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      version: 8,
      layers: [],
      sources: {
        vector: { type: 'vector', tiles: ['https://tiles.openfreemap.org/{z}/{x}/{y}.pbf'] },
      },
    }),
  });
  await expect(
    checkBasemap(getBasemap('openfreemap-dark'), view, new AbortController().signal),
  ).rejects.toThrow('glyphs missing');
});
test('rejects a service error returned as HTTP 200 JSON instead of a raster image', async () => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValue({ ...response(), headers: { get: () => 'application/json' } });
  await expect(
    checkBasemap(getBasemap('usgs-aerial'), view, new AbortController().signal),
  ).rejects.toThrow('resource invalid');
});
