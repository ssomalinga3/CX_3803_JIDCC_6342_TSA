import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { validateBoundaryMap } from '../src/db/boundary-map.js';

const path = new URL('../../data/cascade-springs/approximate-boundary.geojson', import.meta.url);
const snapshot = JSON.parse(readFileSync(path, 'utf8'));
describe('boundary snapshot', () => {
  it('validates one approximate preserve boundary polygon with a closed ring', () => {
    const collection = validateBoundaryMap(snapshot);
    expect(collection.features).toHaveLength(1);
    const feature = collection.features[0]!;
    expect(feature.geometry.type).toBe('Polygon');
    expect(feature.properties).toMatchObject({
      feature_kind: 'boundary',
      boundary_kind: 'preserve',
      name_assignment: 'approximate',
    });
    if (feature.geometry.type !== 'Polygon') throw new Error('Expected polygon');
    const ring = feature.geometry.coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });
  it.each([
    'duplicate',
    'empty',
    'id',
    'type',
    'kind',
    'assignment',
    'range',
    'nonfinite',
    'open-ring',
    'short-ring',
  ])('rejects %s before persistence', (kind) => {
    const data = structuredClone(snapshot);
    if (kind === 'duplicate') data.features.push(data.features[0]);
    if (kind === 'empty') data.features = [];
    if (kind === 'id') data.features[0].id = 'not-a-boundary-id';
    if (kind === 'type') data.features[0].geometry.type = 'LineString';
    if (kind === 'kind') data.features[0].properties.feature_kind = 'trail';
    if (kind === 'assignment') data.features[0].properties.name_assignment = 'authoritative';
    if (kind === 'range') data.features[0].geometry.coordinates[0][0][0] = 181;
    if (kind === 'nonfinite') data.features[0].geometry.coordinates[0][0][1] = Infinity;
    if (kind === 'open-ring') data.features[0].geometry.coordinates[0].pop();
    if (kind === 'short-ring') data.features[0].geometry.coordinates[0] = [[0, 0]];
    expect(() => validateBoundaryMap(data)).toThrow();
  });
});
