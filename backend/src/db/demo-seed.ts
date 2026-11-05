import { sql } from 'drizzle-orm';
import { withDatabase } from './client.js';
import { gisLayer } from './schema.js';

/** Synthetic Atlanta-area shapes, not surveyed preserve boundaries or navigation data. */
const fixtures = [
  {
    layerId: 'demo-trails',
    layerType: 'trail',
    name: 'Synthetic demo trails',
    features: [
      {
        id: 'demo-trail-1',
        name: 'Demo loop segment',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-84.48, 33.72],
            [-84.478, 33.722],
            [-84.476, 33.721],
          ],
        },
        surface_type: 'durable',
      },
      {
        id: 'demo-trail-2',
        name: 'Demo connector',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-84.478, 33.722],
            [-84.477, 33.724],
          ],
        },
        surface_type: 'natural',
      },
    ],
  },
  {
    layerId: 'demo-boundaries',
    layerType: 'boundary',
    name: 'Approximate preserve boundary (guess)',
    features: [
      {
        // Hand-drawn approximation of the preserve outline. Not surveyed or
        // authoritative. Source copy: data/cascade-springs/approximate-boundary.geojson.
        id: 'demo-boundary-1',
        name: 'Approximate preserve boundary (guess, not surveyed)',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-84.48305737587314, 33.71987633879536],
              [-84.48308358003182, 33.71991993001039],
              [-84.48276913012687, 33.71784932287537],
              [-84.48396141934964, 33.71795830344308],
              [-84.48402692974673, 33.715898547308754],
              [-84.48371247984177, 33.714928592121865],
              [-84.48258570101605, 33.714928592121865],
              [-84.47604706646709, 33.71494721848262],
              [-84.47597988871503, 33.715822652974495],
              [-84.4746139410863, 33.715822652974495],
              [-84.47443480041406, 33.718244021036995],
              [-84.47479308175913, 33.718244021036995],
              [-84.47479308175913, 33.718523405265216],
              [-84.47524093344028, 33.718523405265216],
              [-84.4751961482722, 33.718691035365424],
              [-84.47548725186518, 33.718691035365424],
              [-84.47566639253803, 33.71924980000324],
              [-84.4757335702901, 33.71921254914061],
              [-84.47604706646709, 33.71947330484015],
              [-84.47676362915718, 33.71913804736684],
              [-84.47662927365303, 33.719994813863224],
              [-84.47748019184725, 33.71997618859557],
              [-84.47936116890922, 33.7202555671867],
              [-84.48130932372322, 33.720087940141426],
              [-84.48305737587314, 33.71987633879536],
            ],
          ],
        },
      },
    ],
  },
  {
    layerId: 'demo-landmarks',
    layerType: 'landmark',
    name: 'Synthetic demo landmarks',
    features: [
      {
        id: 'demo-landmark-1',
        name: 'Demo trailhead',
        geometry: { type: 'Point', coordinates: [-84.48, 33.72] },
      },
      {
        id: 'demo-landmark-2',
        name: 'Demo overlook',
        geometry: { type: 'Point', coordinates: [-84.477, 33.724] },
      },
    ],
  },
];

export async function seedDemo(connectionString: string): Promise<void> {
  await withDatabase(connectionString, (db) =>
    db.transaction(async (tx) => {
      // Serializes concurrent seed invocations as well as making reruns idempotent.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6342, 1)`);
      for (const layer of fixtures) {
        const metadata = {
          layerId: layer.layerId,
          name: layer.name,
          layerType: layer.layerType,
          description:
            'Synthetic development fixture. Not authoritative preserve data; do not use for navigation.',
          pillar: null,
          source: 'Repository synthetic demo fixtures v1',
          isDemo: true,
          isPublic: true,
        };
        await tx
          .insert(gisLayer)
          .values(metadata)
          .onConflictDoUpdate({ target: gisLayer.layerId, set: metadata });
        for (const feature of layer.features) {
          const properties = {
            name: feature.name,
            isDemo: true,
            ...('surface_type' in feature ? { surface_type: feature.surface_type } : {}),
          };
          await tx.execute(sql`
          INSERT INTO gis_feature (feature_id, layer_id, geometry, properties)
          VALUES (${feature.id}, ${layer.layerId}, ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(feature.geometry)}), 4326), ${JSON.stringify(properties)}::jsonb)
          ON CONFLICT (feature_id) DO UPDATE SET layer_id = EXCLUDED.layer_id, geometry = EXCLUDED.geometry, properties = EXCLUDED.properties
        `);
        }
      }
    }),
  );
}
