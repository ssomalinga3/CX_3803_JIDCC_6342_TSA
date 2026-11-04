// Type-only reuse: no backend database or Worker code enters the mobile bundle.
import type {
  FeatureCollection,
  Geometry,
  Layer,
  LayerCatalog,
} from '../../../backend/src/modules/gis/types';

export type GisSnapshot = {
  layers: Layer[];
  collection: FeatureCollection;
  bounds: [number, number, number, number] | null;
  isDemo: boolean;
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function position(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}

function positions(value: unknown, minimum: number): value is number[][] {
  return Array.isArray(value) && value.length >= minimum && value.every(position);
}

function polygon(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (ring) =>
        positions(ring, 4) &&
        ring[0].length === ring[ring.length - 1].length &&
        ring[0].every((n, i) => n === ring[ring.length - 1][i]),
    )
  );
}

function geometry(value: unknown, depth = 0): value is Geometry {
  if (!object(value) || depth > 8) return false;
  const coords = value.coordinates;
  switch (value.type) {
    case 'Point':
      return position(coords);
    case 'MultiPoint':
      return positions(coords, 1);
    case 'LineString':
      return positions(coords, 2);
    case 'MultiLineString':
      return (
        Array.isArray(coords) && coords.length > 0 && coords.every((line) => positions(line, 2))
      );
    case 'Polygon':
      return polygon(coords);
    case 'MultiPolygon':
      return Array.isArray(coords) && coords.length > 0 && coords.every(polygon);
    case 'GeometryCollection':
      return (
        Array.isArray(value.geometries) &&
        value.geometries.length > 0 &&
        value.geometries.every((child) => geometry(child, depth + 1))
      );
    default:
      return false;
  }
}

export function parseCatalog(value: unknown): LayerCatalog {
  if (!object(value) || !Array.isArray(value.layers)) throw new Error('Invalid layer catalog');
  const ids = new Set<string>();
  for (const layer of value.layers) {
    if (
      !object(layer) ||
      !['layerId', 'name', 'description', 'layerType', 'source', 'featuresUrl'].every(
        (key) => typeof layer[key] === 'string',
      ) ||
      !layer.layerId ||
      typeof layer.isDemo !== 'boolean' ||
      !(layer.pillar === null || typeof layer.pillar === 'string') ||
      ids.has(layer.layerId as string)
    )
      throw new Error('Invalid layer metadata');
    ids.add(layer.layerId as string);
  }
  return { layers: value.layers as Layer[] };
}

export function parseCollection(value: unknown): FeatureCollection {
  if (!object(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) {
    throw new Error('Invalid feature collection');
  }
  const ids = new Set<string>();
  for (const feature of value.features) {
    if (
      !object(feature) ||
      feature.type !== 'Feature' ||
      typeof feature.id !== 'string' ||
      !feature.id ||
      ids.has(feature.id) ||
      !object(feature.properties) ||
      !geometry(feature.geometry)
    ) {
      throw new Error('Invalid GIS feature');
    }
    ids.add(feature.id);
  }
  return { type: 'FeatureCollection', features: value.features as FeatureCollection['features'] };
}

export function apiBaseUrl(value: string, allowHttp = __DEV__): URL {
  const url = new URL(value);
  if (
    !(url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.replace(/\/$/, '') !== '/api/v1'
  )
    throw new Error('Invalid GIS API URL');
  return url;
}

export function featureUrl(base: URL, layer: Layer): string {
  const url = new URL(layer.featuresUrl, base.origin);
  const expected = `/api/v1/layers/${encodeURIComponent(layer.layerId)}/features`;
  if (
    url.origin !== base.origin ||
    url.pathname !== expected ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('Invalid layer URL');
  return url.href;
}

export function collectionBounds(collection: FeatureCollection): GisSnapshot['bounds'] {
  let bounds: GisSnapshot['bounds'] = null;
  function visit(value: unknown) {
    if (position(value)) {
      const [lng, lat] = value;
      bounds = bounds
        ? [
            Math.min(bounds[0], lng),
            Math.min(bounds[1], lat),
            Math.max(bounds[2], lng),
            Math.max(bounds[3], lat),
          ]
        : [lng, lat, lng, lat];
    } else if (Array.isArray(value)) value.forEach(visit);
  }
  function visitGeometry(value: Geometry) {
    if (value.type === 'GeometryCollection') value.geometries.forEach(visitGeometry);
    else visit(value.coordinates);
  }
  collection.features.forEach((feature) => visitGeometry(feature.geometry));
  return bounds;
}

export async function loadPublicGis(value: string, signal: AbortSignal): Promise<GisSnapshot> {
  const base = apiBaseUrl(value);
  async function read(url: string): Promise<unknown> {
    const response = await fetch(url, {
      signal,
      headers: { Accept: 'application/json, application/geo+json' },
    });
    if (!response.ok) throw new Error('GIS request failed');
    return response.json();
  }
  const { layers } = parseCatalog(await read(`${base.origin}/api/v1/layers`));
  // Validate every URL before sending any feature requests.
  const urls = layers.map((layer) => featureUrl(base, layer));
  const collections = await Promise.all(urls.map(async (url) => parseCollection(await read(url))));
  const collection: FeatureCollection = {
    type: 'FeatureCollection',
    features: collections.flatMap((data, i) =>
      data.features.map((feature) => ({
        ...feature,
        id: `${layers[i].layerId}/${feature.id}`,
      })),
    ),
  };
  return {
    layers,
    collection,
    bounds: collectionBounds(collection),
    isDemo:
      layers.some((layer) => layer.isDemo) ||
      collection.features.some((feature) => feature.properties.isDemo === true),
  };
}
