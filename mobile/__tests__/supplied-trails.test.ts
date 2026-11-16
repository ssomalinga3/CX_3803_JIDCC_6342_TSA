import { loadPublicGis } from '@/data/gis';
import { featureDetails } from '@/data/feature-details';
import { trailPresentation } from '@/data/trail-presentation';
import { visibleGis } from '@/data/layer-visibility';

// Test-only fixture read: source data never enters the mobile runtime bundle.
const { readFileSync } = jest.requireActual<{
  readFileSync: (path: string, encoding: string) => string;
}>('node:fs');
const trails = JSON.parse(readFileSync('../data/cascade-springs-gis/trails.geojson', 'utf8'));
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('real supplied snapshot loads all routes, unnamed style and public details without a location request', async () => {
  const layer = {
    layerId: 'cascade-map-trails',
    name: 'Supplied trails',
    description: 'Supplied GIS',
    layerType: 'trail',
    source: 'CSNP export',
    pillar: null,
    isDemo: false,
    featuresUrl: '/api/v1/layers/cascade-map-trails/features',
  };
  const fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ layers: [layer] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => trails });
  globalThis.fetch = fetch;
  const snapshot = await loadPublicGis('https://example.com/api/v1', new AbortController().signal);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(snapshot.collection.features).toHaveLength(36);
  const shown = trailPresentation(snapshot.collection);
  expect(shown.legend).toHaveLength(10);
  expect(shown.legend.map((entry) => entry.id)).toEqual(
    expect.arrayContaining(['bigleaf-magnolia', 'spur', 'unnamed', 'gateway']),
  );
  for (const f of shown.collection.features) {
    if (f.properties.trail_id === 'gateway')
      expect(f.properties._display_trail_casing).toBe('#444444');
    if (f.properties.name_assignment === 'unassigned')
      expect(f.properties._display_trail_dashed).toBe(true);
    if (f.properties.average_width_in)
      expect(featureDetails(snapshot, f.id)?.fields).toContainEqual({
        label: 'Mean tread width',
        value: `${f.properties.average_width_in} in`,
      });
  }
  const hidden = visibleGis(snapshot, new Set(['cascade-map-trails']));
  expect(hidden.collection.features).toEqual([]);
  expect(trailPresentation(hidden.collection).legend).toEqual([]);
  expect(visibleGis(snapshot, new Set()).collection.features).toEqual(snapshot.collection.features);
  expect(snapshot.collection.features).toHaveLength(36);
});
