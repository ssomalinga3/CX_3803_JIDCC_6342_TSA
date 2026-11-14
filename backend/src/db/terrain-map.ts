import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import type { FeatureCollection } from '../modules/gis/types.js';
import { replaceLayers, type ImportLayerSpec } from './gis-import.js';

export const terrainKeys = ['supplied', 'usgs'] as const;
export const terrainLayers: readonly ImportLayerSpec[] = terrainKeys.map((key) => ({
  layerId: `cascade-terrain-${key}`,
  name: key === 'supplied' ? 'Elevation · supplied DTM' : 'Elevation · USGS 3DEP',
  layerType: 'terrain',
  geometryType: 'Polygon',
  description:
    '20 ftUS elevation bands and shaded relief. Source and limitations are in Disclaimers.',
  source:
    key === 'supplied'
      ? 'Supplied csnp_dtm_2015; NAVD88 US survey feet; horizontal datum unknown'
      : 'USGS National Map 3DEP; bounded export; NAVD88 meters converted to US survey feet',
  isDemo: false,
}));
const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const assets = read('../../../mobile/assets/terrain/terrain-assets.json') as Record<
  string,
  {
    dataset_version: string;
    sha256: string;
    source_sha256: string;
    coordinates: number[][];
  }
>;
const keys = new Set([
  'name',
  'feature_kind',
  'isDemo',
  'source_dataset',
  'dataset_version',
  'source',
  'vertical_datum',
  'horizontal_registration',
  'source_sha256',
  'raster_key',
  'raster_sha256',
  'elevation_min_ft_us',
  'elevation_max_ft_us',
]);
function object(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function position(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    v[0] >= -84.485 &&
    v[0] <= -84.474 &&
    v[1] >= 33.714 &&
    v[1] <= 33.721
  );
}
/** Validate provenance, versioned bundled-image placement, units and explicit source ownership. */
export function validateTerrainMap(value: unknown): FeatureCollection {
  if (
    !object(value) ||
    value.type !== 'FeatureCollection' ||
    !Array.isArray(value.features) ||
    value.features.length < 4 ||
    value.features.length > 500
  )
    throw new Error('Invalid terrain collection');
  const ids = new Set<string>();
  for (const f of value.features) {
    if (
      !object(f) ||
      f.type !== 'Feature' ||
      typeof f.id !== 'string' ||
      ids.has(f.id) ||
      !object(f.properties) ||
      !object(f.geometry)
    )
      throw new Error('Invalid terrain feature');
    ids.add(f.id);
    const p = f.properties;
    const key = terrainKeys.find((k) => p.source_dataset === `csnp-terrain-${k}`);
    const asset = key && assets[key];
    if (
      !key ||
      !asset ||
      p.dataset_version !== asset.dataset_version ||
      p.isDemo !== false ||
      typeof p.name !== 'string' ||
      !p.name ||
      typeof p.source !== 'string' ||
      p.source_sha256 !== asset.source_sha256 ||
      typeof p.vertical_datum !== 'string' ||
      !p.vertical_datum.startsWith('NAVD88') ||
      typeof p.horizontal_registration !== 'string' ||
      Object.keys(p).some((k) => !keys.has(k))
    ) {
      throw new Error('Invalid terrain provenance');
    }
    const rings = f.geometry.coordinates;
    if (
      f.geometry.type !== 'Polygon' ||
      !Array.isArray(rings) ||
      !rings.length ||
      rings.some(
        (r) =>
          !Array.isArray(r) ||
          r.length < 4 ||
          !r.every(position) ||
          JSON.stringify(r[0]) !== JSON.stringify(r[r.length - 1]),
      )
    )
      throw new Error('Invalid terrain polygon');
    if (p.feature_kind === 'hillshade') {
      if (
        f.id !== `csnp-terrain-${key}-hillshade` ||
        p.raster_key !== key ||
        p.raster_sha256 !== asset.sha256 ||
        'elevation_min_ft_us' in p ||
        'elevation_max_ft_us' in p ||
        JSON.stringify(rings) !== JSON.stringify([[...asset.coordinates, asset.coordinates[0]]])
      ) {
        throw new Error('Terrain image/metadata version mismatch');
      }
    } else if (p.feature_kind === 'elevation_band') {
      const low = p.elevation_min_ft_us,
        high = p.elevation_max_ft_us;
      if (
        !new RegExp(`^csnp-terrain-${key}-band-\\d{4}$`).test(f.id) ||
        typeof low !== 'number' ||
        !Number.isFinite(low) ||
        low < 780 ||
        low > 1100 ||
        low % 20 !== 0 ||
        typeof high !== 'number' ||
        high !== low + 20 ||
        'raster_key' in p ||
        'raster_sha256' in p
      ) {
        throw new Error('Invalid terrain elevation band');
      }
    } else throw new Error('Unsupported terrain kind');
  }
  for (const key of terrainKeys) {
    const features = value.features.filter(
      (f) => f.properties.source_dataset === `csnp-terrain-${key}`,
    );
    if (
      features.filter((f) => f.properties.feature_kind === 'hillshade').length !== 1 ||
      !features.some((f) => f.properties.feature_kind === 'elevation_band')
    )
      throw new Error('Incomplete terrain source');
  }
  return value as unknown as FeatureCollection;
}
export function readTerrainMap(): FeatureCollection {
  return validateTerrainMap(read('../../../data/cascade-springs-gis/terrain.geojson'));
}
export function terrainReplacements(collection: FeatureCollection) {
  return terrainLayers.map((layer, index) => ({
    layer,
    collection: {
      type: 'FeatureCollection' as const,
      features: collection.features.filter(
        (f) => f.properties.source_dataset === `csnp-terrain-${terrainKeys[index]}`,
      ),
    },
  }));
}
export async function importTerrainMap(connectionString: string, value: unknown): Promise<void> {
  await replaceLayers(connectionString, 2, terrainReplacements(validateTerrainMap(value)));
}
