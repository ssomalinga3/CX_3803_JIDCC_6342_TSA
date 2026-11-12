import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type { FeatureCollection } from '../modules/gis/types.js';
import { replaceLayers, type ImportLayerSpec } from './gis-import.js';

export const trailContract: {
  version: number;
  dataset: string;
  bounds: [number, number, number, number];
  routes: Record<string, string>;
  raw_fields: string[];
} = JSON.parse(
  readFileSync(
    new URL('../../../data/cascade-springs-gis/trail-contract.json', import.meta.url),
    'utf8',
  ),
);
const manifest = JSON.parse(
  readFileSync(new URL('../../../data/cascade-springs-gis/manifest.json', import.meta.url), 'utf8'),
);
export const trailArchiveHash: string = manifest.inventory.inputs[0].sha256;
export const officialTrailLayer: ImportLayerSpec = {
  layerId: 'cascade-map-trails',
  name: 'Cascade Springs trails (supplied GIS)',
  layerType: 'trail',
  geometryType: 'LineString',
  description:
    'Supplied GIS trail segments, exported 2026-04-09. Source names and attributes; segment lengths calculated geodesically. Missing difficulty remains unknown.',
  source: 'Supplied CSNP GIS archive — OfficialTrailsCSNP.shp (2026-04-09 export)',
  isDemo: false,
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const numericRawFields = new Set([
  'AVG_WIDTH',
  'GRADE',
  'ELEV_GAIN',
  'LENGTH_MI',
  'Shape__Len',
  'AvgSegment',
  'Shape__L_1',
]);

/** Validate the complete public property contract before starting a replacement. */
export function validateOfficialTrails(value: unknown): FeatureCollection {
  if (
    !object(value) ||
    value.type !== 'FeatureCollection' ||
    !Array.isArray(value.features) ||
    !value.features.length
  )
    throw new Error('Invalid supplied trail collection');
  const ids = new Set<string>();
  const segments = new Set<string>();
  for (const feature of value.features) {
    if (
      !object(feature) ||
      feature.type !== 'Feature' ||
      typeof feature.id !== 'string' ||
      !object(feature.properties)
    )
      throw new Error('Invalid supplied trail feature');
    const p = feature.properties;
    const raw = p.source_properties;
    if (
      !object(raw) ||
      !isDeepStrictEqual(Object.keys(raw).sort(), [...trailContract.raw_fields].sort()) ||
      Object.entries(raw).some(
        ([key, v]) =>
          v !== null &&
          (numericRawFields.has(key)
            ? typeof v !== 'number' || !Number.isFinite(v)
            : typeof v !== 'string'),
      ) ||
      typeof raw.GlobalID !== 'string' ||
      !/^\{[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}\}$/i.test(raw.GlobalID) ||
      typeof raw.SEGMENT_ID !== 'string' ||
      !raw.SEGMENT_ID.trim() ||
      typeof raw.TRL_NM !== 'string' ||
      raw.PublishTra !== 'TRUE'
    )
      throw new Error('Invalid or nonpublic supplied trail source properties');
    const id = `csnp-official-trail-${raw.GlobalID.slice(1, -1).toLowerCase()}`;
    if (feature.id !== id || ids.has(id) || segments.has(raw.SEGMENT_ID))
      throw new Error('Duplicate or mismatched supplied trail identity');
    ids.add(id);
    segments.add(raw.SEGMENT_ID);
    const name = raw.TRL_NM.trim();
    const route = Object.hasOwn(trailContract.routes, name)
      ? trailContract.routes[name]
      : undefined;
    if (name && !route) throw new Error('Unmapped supplied trail name');
    const difficulty =
      typeof raw.Difficulty === 'string' ? raw.Difficulty.trim().toLowerCase() : '';
    if (difficulty && !['easy', 'moderate', 'difficult'].includes(difficulty))
      throw new Error('Invalid supplied difficulty');
    if (typeof raw.AVG_WIDTH === 'number' && raw.AVG_WIDTH < 0)
      throw new Error('Invalid source width');
    const expected: Record<string, unknown> = {
      name: name || 'Unnamed trail segment',
      feature_kind: 'trail',
      name_assignment: name ? 'source' : 'unassigned',
      length_m: p.length_m,
      source_dataset: trailContract.dataset,
      source_file: 'CSNP/OfficialTrailsCSNP.shp',
      source_archive_sha256: trailArchiveHash,
      source_crs: 'EPSG:3857',
      source_feature_id: raw.GlobalID,
      source_segment_id: raw.SEGMENT_ID,
      source_properties: raw,
      isDemo: false,
      derived_values: {
        length_m: {
          method: 'WGS84 ellipsoidal segment sum',
          tool: 'pyproj.Geod',
          source_dataset: trailContract.dataset,
        },
        ...(route
          ? {
              trail_id: {
                method: 'explicit source-name route-family mapping',
                contract_version: trailContract.version,
              },
            }
          : {}),
      },
      ...(route ? { trail_id: route } : {}),
      ...(difficulty ? { difficulty } : {}),
      ...(typeof raw.AVG_WIDTH === 'number' && raw.AVG_WIDTH > 0
        ? { average_width_in: raw.AVG_WIDTH }
        : {}),
    };
    for (const [source, target] of [
      ['SURFACE', 'surface_type'],
      ['ROUGHNESS', 'roughness'],
      ['NOTES', 'description'],
    ] as const) {
      if (typeof raw[source] === 'string' && raw[source].trim())
        expected[target] = raw[source].trim();
    }
    if (
      typeof p.length_m !== 'number' ||
      !Number.isFinite(p.length_m) ||
      p.length_m <= 0 ||
      !isDeepStrictEqual(p, expected, { skipPrototype: true })
    )
      throw new Error('Invalid normalized supplied trail properties');
    const geometry = feature.geometry;
    const [west, south, east, north] = trailContract.bounds;
    if (
      !object(geometry) ||
      geometry.type !== 'LineString' ||
      !Array.isArray(geometry.coordinates) ||
      geometry.coordinates.length < 2 ||
      geometry.coordinates.some(
        (point: unknown) =>
          !Array.isArray(point) ||
          point.length !== 2 ||
          point.some((n) => typeof n !== 'number' || !Number.isFinite(n)) ||
          point[0] < west ||
          point[0] > east ||
          point[1] < south ||
          point[1] > north,
      )
    )
      throw new Error('Invalid supplied trail geometry');
  }
  return value as unknown as FeatureCollection;
}

export function readOfficialTrails(): FeatureCollection {
  return validateOfficialTrails(
    JSON.parse(
      readFileSync(
        new URL('../../../data/cascade-springs-gis/trails.geojson', import.meta.url),
        'utf8',
      ),
    ),
  );
}

/** Same advisory lock as the combined source importer; never touches landmarks. */
export async function importOfficialTrails(
  connectionString: string,
  value: unknown,
): Promise<void> {
  const collection = validateOfficialTrails(value);
  await replaceLayers(connectionString, 2, [{ layer: officialTrailLayer, collection }]);
}
