import { featureDetails, featureText, pressedFeatureId } from '@/data/feature-details';
import type { GisSnapshot } from '@/data/gis';
import { collection, layer } from './fixtures/gis';

const line = { ...collection.features[0], id: 'line', properties: { name: 'Terrace Trail' } };
const point = {
  ...line,
  id: 'point',
  geometry: { type: 'Point' as const, coordinates: [-84.48, 33.72] as [number, number] },
};
const snapshot: GisSnapshot = {
  layers: [layer],
  collection: { type: 'FeatureCollection', features: [line, point] },
  bounds: null,
  isDemo: true,
  featureLayers: new Map([
    ['line', layer],
    ['point', layer],
  ]),
};

test('hit testing prefers landmarks over overlapping trails and ignores unknown/native-only properties', () => {
  expect(
    pressedFeatureId(snapshot, [{ id: 'line' }, { id: 'point', properties: { name: 'Forged' } }]),
  ).toBe('point');
  expect(pressedFeatureId(snapshot, [{ id: 'line' }, { id: 'line' }])).toBe('line');
  expect(pressedFeatureId(snapshot, [{ id: 'device-location' }, { id: 1 }, null])).toBeUndefined();
  expect(pressedFeatureId(snapshot, undefined)).toBeUndefined();
  expect(featureDetails(snapshot, 'missing')).toBeUndefined();
  expect(featureDetails(snapshot, 'point')?.title).toBe('Terrace Trail');
});

test('extracts source text without scripts, style, image tags, or active links', () => {
  expect(
    featureText(
      '<script>alert(1)</script><style>bad</style><!-- hidden --><img src="https://example.com/x" /><p>Creek &amp; spring &#x1f333;</p>',
    ),
  ).toBe('Creek & spring 🌳');
  expect(featureText({ html: 'bad' })).toBe('');
  expect(featureText('a'.repeat(50000))).toHaveLength(4000);
  expect(featureText('&#99999999;')).toBe('');
});

test('uses only available public display fields and leaves missing pillar/difficulty/length absent', () => {
  const data = featureDetails(snapshot, 'line')!;
  expect(data.description).toBe('No description available.');
  expect(data.fields).toContainEqual({ label: 'Layer', value: layer.name });
  expect(data.fields).toContainEqual({ label: 'Source', value: layer.source });
  expect(data.fields.map((field) => field.label)).not.toContain('Pillar');
  expect(data.fields.map((field) => field.label)).not.toContain('Difficulty');
  const updated = {
    ...snapshot,
    collection: {
      ...snapshot.collection,
      features: [
        {
          ...line,
          properties: {
            name: {},
            description_html: '<p>Restoration area</p>',
            difficulty: 'Easy',
            surface_type: 'durable',
            length_m: 120,
            private_recipient: 'hidden@example.com',
            _display_trail_color: 'internal',
          },
        },
      ],
    },
  };
  const details = featureDetails(updated, 'line')!;
  expect(details.title).toBe('Map feature');
  expect(details.description).toBe('Restoration area');
  expect(details.fields).toContainEqual({ label: 'Length', value: '120 m' });
  expect(JSON.stringify(details)).not.toContain('hidden@example.com');
  expect(JSON.stringify(details)).not.toContain('internal');
});
