import type { GisSnapshot } from '@/data/gis';
import { collection, layer } from './gis';

export const publicLayers = [
  { ...layer, layerId: 'trails', name: 'Preserve trails', isDemo: false, pillar: 'Environmental' },
  {
    ...layer,
    layerId: 'landmarks',
    name: 'Landmarks',
    layerType: 'landmark',
    isDemo: false,
    pillar: null,
  },
  {
    ...layer,
    layerId: 'boundary',
    name: 'Preserve outline',
    layerType: 'boundary',
    isDemo: false,
    pillar: null,
  },
];
export function layersSnapshot(): GisSnapshot {
  return {
    layers: publicLayers,
    featureLayers: new Map(publicLayers.map((item, index) => [`${item.layerId}/${index}`, item])),
    collection: {
      type: 'FeatureCollection',
      features: [
        {
          ...collection.features[0],
          id: 'trails/0',
          properties: { name: 'Terrace Trail', feature_kind: 'trail', trail_id: 'terrace' },
        },
        {
          type: 'Feature',
          id: 'landmarks/1',
          properties: { name: 'Spring' },
          geometry: { type: 'Point', coordinates: [-84.48, 33.72] },
        },
        {
          type: 'Feature',
          id: 'boundary/2',
          properties: { name: 'Outline' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-84.48, 33.72],
                [-84.47, 33.72],
                [-84.47, 33.73],
                [-84.48, 33.72],
              ],
            ],
          },
        },
      ],
    },
    bounds: [-84.48, 33.72, -84.47, 33.73],
    isDemo: false,
  };
}
