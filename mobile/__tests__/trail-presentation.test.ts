import { trailPresentation } from '@/data/trail-presentation';
import { collection } from './fixtures/gis';

function present(properties: Record<string, unknown>[]) {
  return trailPresentation({
    ...collection,
    features: properties.map((props, index) => ({
      ...collection.features[0],
      id: `section-${index}`,
      properties: props,
    })),
  });
}

test('matches all seven current identities to the sign palette and deduplicates Gateway sections', () => {
  const ids = [
    'springs',
    'white-oak',
    'turkeyfoot-utoy-creek',
    'battle-ridge',
    'west',
    'terrace',
    'gateway',
    'gateway',
  ];
  const result = present(ids.map((trail_id) => ({ feature_kind: 'trail', trail_id })));
  expect(result.collection.features.map((f) => f.properties._display_trail_color)).toEqual([
    '#C95700',
    '#73C6D5',
    '#2864B4',
    '#D65388',
    '#C9363E',
    '#78479B',
    '#FFFFFF',
    '#FFFFFF',
  ]);
  expect(
    result.collection.features.slice(-2).map((f) => f.properties._display_trail_casing),
  ).toEqual(['#444444', '#444444']);
  expect(result.legend).toHaveLength(7);
  expect(result.legend.map((entry) => entry.name)).not.toContain('Bigleaf Magnolia Trail');
  expect(result.legend.map((entry) => entry.name)).not.toContain('Spur Trails');
  for (const entry of result.legend) {
    const feature = result.collection.features.find((f) => f.properties.trail_id === entry.id)!;
    expect(entry.color).toBe(feature.properties._display_trail_color);
    expect(entry.casing).toBe(feature.properties._display_trail_casing);
  }
});

test.each([undefined, null, 12, [], {}, 'unknown-route', '__proto__', 'constructor'])(
  'uses a safe neutral fallback for malformed or unknown trail ID %p',
  (trail_id) => {
    const result = present([
      { feature_kind: 'trail', trail_id, color: 'red', _display_trail_color: 'red' },
    ]);
    expect(result.collection.features[0].properties._display_trail_color).toBe('#60646C');
    expect(result.legend[0]).toMatchObject({ name: 'Other trails', dashed: false });
  },
);

test('unassigned connections remain dashed neutral even with a conflicting ID', () => {
  const result = present([
    { name_assignment: 'unassigned', feature_kind: 'trail', trail_id: 'gateway' },
  ]);
  expect(result.collection.features[0].properties).toMatchObject({
    _display_trail_color: '#60646C',
    _display_trail_casing: '#FFFFFF',
    _display_trail_dashed: true,
  });
  expect(result.legend[0]).toMatchObject({
    name: 'Unnamed connections',
    colorName: 'Gray, dashed',
  });
});

test('preserves input properties and geometry, excludes non-line features, and supports multiline routes', () => {
  const input: typeof collection = {
    ...collection,
    features: [
      {
        ...collection.features[0],
        properties: { feature_kind: 'trail', trail_id: 'terrace', name_assignment: 'approximate' },
      },
      {
        ...collection.features[0],
        id: 'point',
        geometry: { type: 'Point' as const, coordinates: [0, 0] },
        properties: { trail_id: 'spur' },
      },
      {
        ...collection.features[0],
        id: 'multiline',
        geometry: {
          type: 'MultiLineString' as const,
          coordinates: [
            [
              [0, 0],
              [1, 1],
            ],
          ],
        },
        properties: { feature_kind: 'trail', trail_id: 'gateway' },
      },
    ],
  };
  const before = JSON.stringify(input);
  const result = trailPresentation(input);
  expect(JSON.stringify(input)).toBe(before);
  expect(result.collection.features.map((f) => f.geometry)).toEqual(
    input.features.map((f) => f.geometry),
  );
  expect(result.collection.features[0].properties.name_assignment).toBe('approximate');
  expect(result.collection.features[1]).toBe(input.features[1]);
  expect(result.legend.map((entry) => entry.name)).toEqual(['Gateway Trail', 'Terrace Trail']);
  expect(result.collection.features[2].properties._display_trail_color).toBe('#FFFFFF');
});

test('empty data and point-only data have no trail legend; generic lines remain neutral', () => {
  expect(trailPresentation({ type: 'FeatureCollection', features: [] }).legend).toEqual([]);
  expect(present([{ trail_id: 'gateway' }]).legend[0].name).toBe('Other trails');
});
