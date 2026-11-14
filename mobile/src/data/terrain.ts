import assets from '../../assets/terrain/terrain-assets.json';
import type { GisSnapshot } from '@/data/gis';

export const terrainKeys = ['supplied', 'usgs'] as const;
export type TerrainKey = (typeof terrainKeys)[number];
export const terrainAssets = assets;
type Feature = GisSnapshot['collection']['features'][number];

/** Raster bytes are bundled, never fetched from a URL supplied by public properties. */
export function validateTerrainAssets(layers: GisSnapshot['layers'], features: Feature[]): void {
  for (const key of terrainKeys) {
    const id = `cascade-terrain-${key}`;
    const layer = layers.find((l) => l.layerId === id);
    if (!layer) continue;
    const owned = features.filter((f) => f.id.startsWith(`${id}/`));
    const expected = assets[key];
    const images = owned.filter((f) => f.properties.feature_kind === 'hillshade');
    const image = images[0];
    if (
      layer.layerType !== 'terrain' ||
      images.length !== 1 ||
      !image ||
      !owned.some((f) => f.properties.feature_kind === 'elevation_band') ||
      owned.some(
        (f) =>
          f.properties.dataset_version !== expected.dataset_version ||
          f.properties.source_dataset !== `csnp-terrain-${key}` ||
          f.properties.source_sha256 !== expected.source_sha256 ||
          !['elevation_band', 'hillshade'].includes(String(f.properties.feature_kind)),
      ) ||
      image.properties.raster_key !== key ||
      image.properties.raster_sha256 !== expected.sha256 ||
      image.geometry.type !== 'Polygon' ||
      JSON.stringify(image.geometry.coordinates) !==
        JSON.stringify([[...expected.coordinates, expected.coordinates[0]]])
    ) {
      throw new Error('Terrain assets do not match the GIS snapshot. Update the app and retry.');
    }
    for (const feature of owned.filter((f) => f.properties.feature_kind === 'elevation_band')) {
      const { elevation_min_ft_us: low, elevation_max_ft_us: high } = feature.properties;
      if (
        feature.geometry.type !== 'Polygon' ||
        typeof low !== 'number' ||
        !Number.isFinite(low) ||
        low < 780 ||
        low > 1100 ||
        low % 20 !== 0 ||
        high !== low + 20
      ) {
        throw new Error('Invalid terrain elevation band');
      }
    }
  }
  // Reserved image kinds cannot introduce remote image URLs or unknown image keys.
  for (const feature of features.filter((f) =>
    ['hillshade', 'elevation_band'].includes(String(f.properties.feature_kind)),
  )) {
    if (
      !terrainKeys.some(
        (key) =>
          layers.some((l) => l.layerId === `cascade-terrain-${key}`) &&
          feature.id.startsWith(`cascade-terrain-${key}/csnp-terrain-${key}-`),
      )
    ) {
      throw new Error('Unsupported GIS terrain image');
    }
  }
}

export function visibleTerrainKeys(snapshot: GisSnapshot | undefined): TerrainKey[] {
  return terrainKeys.filter((key) =>
    snapshot?.layers.some((l) => l.layerId === `cascade-terrain-${key}`),
  );
}
