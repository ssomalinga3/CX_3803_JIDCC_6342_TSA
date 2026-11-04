import type { FeatureCollection, Layer } from '../../../backend/src/modules/gis/types';

export const layer: Layer = {
  layerId: 'demo-trails',
  name: 'Synthetic demo trails',
  description: 'Not for navigation',
  layerType: 'trail',
  pillar: null,
  source: 'Test fixture',
  isDemo: true,
  featuresUrl: '/api/v1/layers/demo-trails/features',
};
export const collection: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'trail-1',
      properties: { isDemo: true },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-84.48, 33.72],
          [-84.478, 33.722],
        ],
      },
    },
  ],
};
