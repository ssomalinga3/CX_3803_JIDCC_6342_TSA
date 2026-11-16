import type { FeatureCollection, Layer } from '../../../backend/src/modules/gis/types';
import { collectionBounds, type GisSnapshot } from '@/data/gis';
const { readFileSync } = jest.requireActual<{ readFileSync: (p: string, e: string) => string }>(
  'node:fs',
);
const read = (name: string): FeatureCollection =>
  JSON.parse(readFileSync(`../data/cascade-springs-gis/${name}.geojson`, 'utf8'));

/** Public catalog fixtures backed by the committed source collections. */
export function suppliedSnapshot(): GisSnapshot {
  const pdf = read('pdf-map');
  const terrain = read('terrain');
  const groups: [string, string, string, FeatureCollection['features']][] = [
    ['cascade-map-trails', 'Trails', 'trail', read('trails').features],
    ...(['boundary', 'water', 'natural_area', 'road', 'building', 'landmark'] as const).map(
      (kind): [string, string, string, FeatureCollection['features']] => [
        `cascade-map-${{ boundary: 'boundary', water: 'water', natural_area: 'natural-areas', road: 'roads', building: 'buildings', landmark: 'landmarks' }[kind]}`,
        {
          boundary: 'Boundary',
          water: 'Water',
          natural_area: 'Natural areas',
          road: 'Roads',
          building: 'Buildings',
          landmark: 'Landmarks',
        }[kind],
        kind,
        pdf.features.filter((f) => f.properties.feature_kind === kind),
      ],
    ),
    ...(['supplied', 'usgs'] as const).map(
      (key): [string, string, string, FeatureCollection['features']] => [
        `cascade-terrain-${key}`,
        `Elevation ${key}`,
        'terrain',
        terrain.features.filter((f) => f.properties.source_dataset === `csnp-terrain-${key}`),
      ],
    ),
    ['cascade-cell-signal', 'Cell-signal observations', 'cell_signal', read('signal').features],
  ];
  const layers: Layer[] = groups.map(([id, name, type]) => ({
    layerId: id,
    name,
    layerType: type,
    description: '',
    source: 'Supplied GIS',
    pillar: null,
    isDemo: false,
    featuresUrl: `/api/v1/layers/${id}/features`,
  }));
  const featureLayers = new Map<string, Layer>();
  const collection: FeatureCollection = {
    type: 'FeatureCollection',
    features: groups.flatMap(([, , , features], i) =>
      features.map((f) => {
        const id = `${layers[i].layerId}/${f.id}`;
        featureLayers.set(id, layers[i]);
        return { ...f, id };
      }),
    ),
  };
  return { layers, collection, featureLayers, bounds: collectionBounds(collection), isDemo: false };
}
