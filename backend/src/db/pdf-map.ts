import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import type { FeatureCollection, Position } from '../modules/gis/types.js';
import { replaceLayers, type ImportLayerSpec } from './gis-import.js';

const layerDefinitions: readonly [string, string, string, 'Point' | 'Polygon'][] = [
  ['boundary', 'cascade-map-boundary', 'Preserve boundary', 'Polygon'],
  ['water', 'cascade-map-water', 'Water', 'Polygon'],
  ['natural_area', 'cascade-map-natural-areas', 'Natural areas', 'Polygon'],
  ['road', 'cascade-map-roads', 'Road footprints', 'Polygon'],
  ['building', 'cascade-map-buildings', 'Building footprints', 'Polygon'],
  ['landmark', 'cascade-map-landmarks', 'Landmarks and source annotations', 'Point'],
];
export const pdfMapLayers: readonly ImportLayerSpec[] = layerDefinitions.map(
  ([layerType, layerId, name, geometryType]) => ({
    layerId,
    name: `Cascade Springs ${name.toLowerCase()}`,
    layerType,
    geometryType,
    description: `${name} recovered from the supplied georeferenced trail map. Landmark symbols use cartographic centers; unmatched My Maps annotations retain original coordinates.`,
    source: 'Supplied CSNP Trail Map.pdf (2026-04-14); reconciled My Maps annotations (2026-11-04)',
    isDemo: false,
  }),
);
const sourceGroups: Record<string, string> = {
  boundary: 'Park Boundaries',
  water: 'Bodies of Water',
  natural_area: 'Natural Areas',
  road: 'Roads',
  building: 'Buildings',
  landmark: 'Points of Interest',
};
const pdfKeys = new Set([
  'name',
  'feature_kind',
  'isDemo',
  'source_dataset',
  'source_file',
  'source_sha256',
  'positioning',
  'source_group',
  'source_paths',
  'boundary_kind',
  'water_kind',
  'landmark_kind',
  'source_symbol',
  'source_page_anchor',
  'source_page_bbox',
  'description',
  'source_annotations',
]);
const hash = '3c6a6014d6f3da8b9b635cba129a437dd990b45c742809b5d30293d0a5aa29e4';
function object(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function position(v: unknown): v is Position {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    v[0] >= -84.48438 &&
    v[0] <= -84.47411 &&
    v[1] >= 33.71162 &&
    v[1] <= 33.72052
  );
}
/** Structural and provenance validation; PostGIS enforces polygon topology in transaction. */
export function validatePdfMap(value: unknown): FeatureCollection {
  if (
    !object(value) ||
    value.type !== 'FeatureCollection' ||
    !Array.isArray(value.features) ||
    !value.features.length
  )
    throw new Error('Invalid PDF map collection');
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
      throw new Error('Invalid PDF map feature');
    ids.add(f.id);
    const p = f.properties;
    const layer = pdfMapLayers.find((l) => l.layerType === p.feature_kind);
    if (
      !layer ||
      f.geometry.type !== layer.geometryType ||
      typeof p.name !== 'string' ||
      !p.name ||
      typeof p.positioning !== 'string'
    )
      throw new Error('Invalid PDF layer membership');
    if (f.id.startsWith('csnp-pdf-')) {
      if (
        p.isDemo !== false ||
        p.source_dataset !== 'csnp-pdf-map' ||
        p.source_sha256 !== hash ||
        p.source_file !== 'data/cascade-springs-gis/sources/CSNP Trail Map.pdf' ||
        p.source_group !== sourceGroups[String(p.feature_kind)] ||
        Object.keys(p).some((key) => !pdfKeys.has(key)) ||
        (p.feature_kind === 'landmark'
          ? !/^csnp-pdf-poi-[a-z-]+$/.test(f.id) ||
            typeof p.landmark_kind !== 'string' ||
            !Array.isArray(p.source_page_anchor) ||
            p.source_page_anchor.length !== 2 ||
            !p.source_page_anchor.every((n) => typeof n === 'number' && Number.isFinite(n))
          : !new RegExp(`^csnp-pdf-${String(p.feature_kind)}-\\d{3}$`).test(f.id) ||
            !Array.isArray(p.source_paths) ||
            !p.source_paths.length ||
            !p.source_paths.every(Number.isInteger))
      )
        throw new Error('Invalid PDF source provenance');
    } else if (
      !/^cascade-map-[a-f0-9]{16}$/.test(f.id) ||
      p.feature_kind !== 'landmark' ||
      p.landmark_kind !== 'source_annotation' ||
      p.source_url !== 'https://www.google.com/maps/d/viewer?mid=1Q5BTcAcUwxp9Y320UwsszoCLO0k' ||
      p.isDemo !== false
    ) {
      throw new Error('Invalid retained source annotation');
    }
    if (p.feature_kind === 'water' && p.water_kind !== 'stream')
      throw new Error('Invalid water kind');
    if (p.feature_kind === 'boundary' && p.boundary_kind !== 'preserve')
      throw new Error('Invalid boundary kind');
    if (f.geometry.type === 'Point') {
      if (!position(f.geometry.coordinates)) throw new Error('Invalid PDF point');
    } else {
      const rings = f.geometry.coordinates;
      if (
        !Array.isArray(rings) ||
        !rings.length ||
        rings.some(
          (r) =>
            !Array.isArray(r) ||
            r.length < 4 ||
            !r.every(position) ||
            r[0]![0] !== r[r.length - 1]![0] ||
            r[0]![1] !== r[r.length - 1]![1],
        )
      )
        throw new Error('Invalid PDF polygon ring');
    }
  }
  for (const layer of pdfMapLayers) {
    if (!value.features.some((f) => f.properties.feature_kind === layer.layerType))
      throw new Error('Missing PDF layer assignment');
  }
  return value as unknown as FeatureCollection;
}
export function readPdfMap(): FeatureCollection {
  return validatePdfMap(
    JSON.parse(
      readFileSync(
        new URL('../../../data/cascade-springs-gis/pdf-map.geojson', import.meta.url),
        'utf8',
      ),
    ),
  );
}
export function pdfMapReplacements(collection: FeatureCollection) {
  return pdfMapLayers.map((layer) => ({
    layer,
    collection: {
      type: 'FeatureCollection' as const,
      features: collection.features.filter((f) => f.properties.feature_kind === layer.layerType),
    },
  }));
}
/** All writers of the selected map/boundary/landmark data share source lock (6342,2). */
export async function importPdfMap(connectionString: string, value: unknown): Promise<void> {
  await replaceLayers(connectionString, 2, pdfMapReplacements(validatePdfMap(value)));
}
