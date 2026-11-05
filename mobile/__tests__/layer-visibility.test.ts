import { visibleGis } from '@/data/layer-visibility';
import { pressedFeatureId } from '@/data/feature-details';
import { trailPresentation } from '@/data/trail-presentation';
import { layersSnapshot } from './fixtures/layers';

test('filters independent layers without changing IDs, provenance or the source snapshot', () => {
  const snapshot = layersSnapshot();
  for (const id of ['trails', 'landmarks', 'boundary']) {
    const shown = visibleGis(snapshot, new Set([id]));
    expect(shown.layers.map((layer) => layer.layerId)).not.toContain(id);
    expect(shown.collection.features).toHaveLength(2);
    expect(
      shown.collection.features.every((feature) => snapshot.collection.features.includes(feature)),
    ).toBe(true);
    expect(shown.featureLayers.size).toBe(2);
  }
  expect(snapshot.collection.features).toHaveLength(3);
  expect(visibleGis(snapshot, new Set(['unknown']))).toBe(snapshot);
});

test('combined/all-off choices remove hidden detail hits and legend entries without duplicating re-enabled features', () => {
  const snapshot = layersSnapshot();
  const hidden = visibleGis(snapshot, new Set(['trails', 'landmarks']));
  expect(hidden.collection.features.map((feature) => feature.id)).toEqual(['boundary/2']);
  expect(pressedFeatureId(hidden, [{ id: 'trails/0' }, { id: 'landmarks/1' }])).toBeUndefined();
  expect(trailPresentation(hidden.collection).legend).toEqual([]);
  const empty = visibleGis(snapshot, new Set(snapshot.layers.map((layer) => layer.layerId)));
  expect(empty.layers).toEqual([]);
  expect(empty.collection.features).toEqual([]);
  expect(empty.featureLayers.size).toBe(0);
  for (let i = 0; i < 5; i++)
    expect(visibleGis(snapshot, new Set()).collection.features).toHaveLength(3);
});
