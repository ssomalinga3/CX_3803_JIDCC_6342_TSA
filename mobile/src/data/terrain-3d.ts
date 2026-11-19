import elevation from '../../assets/terrain-3d/elevation-metadata.json';
import type { GisSnapshot } from '@/data/gis';
import { trailPresentation } from '@/data/trail-presentation';

export { elevation };
export const TERRAIN_STARTUP_TIMEOUT = 15000;
export type TerrainViewState = {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
};
export const initialTerrainView: TerrainViewState = {
  center: [-84.4792, 33.7176],
  zoom: 15.8,
  bearing: -25,
  pitch: 60,
};
export function insideTerrain(position: readonly number[]) {
  const [west, south, east, north] = elevation.bounds;
  return (
    position.length === 2 &&
    position.every(Number.isFinite) &&
    position[0] >= west &&
    position[0] <= east &&
    position[1] >= south &&
    position[1] <= north
  );
}

/** Liang–Barsky clipping keeps covered portions instead of hiding a crossing trail. */
function coveredLines(lines: number[][][]): [number, number][][] {
  const [west, south, east, north] = elevation.bounds;
  const result: [number, number][][] = [];
  for (const line of lines) {
    let current: [number, number][] | undefined;
    for (let i = 1; i < line.length; i++) {
      const [x, y] = line[i - 1],
        [endX, endY] = line[i];
      const dx = endX - x,
        dy = endY - y;
      let start = 0,
        end = 1;
      for (const [p, q] of [
        [-dx, x - west],
        [dx, east - x],
        [-dy, y - south],
        [dy, north - y],
      ]) {
        if (p === 0) {
          if (q < 0) {
            start = 1;
            end = 0;
            break;
          }
        } else if (p < 0) start = Math.max(start, q / p);
        else end = Math.min(end, q / p);
      }
      if (start >= end) {
        current = undefined;
        continue;
      }
      const a: [number, number] = [
          Math.max(west, Math.min(east, x + start * dx)),
          Math.max(south, Math.min(north, y + start * dy)),
        ],
        b: [number, number] = [
          Math.max(west, Math.min(east, x + end * dx)),
          Math.max(south, Math.min(north, y + end * dy)),
        ];
      const last = current?.[current.length - 1];
      if (!last || !a.every((n, index) => Math.abs(n - last[index]) < 1e-10)) {
        current = [a];
        result.push(current);
      }
      current!.push(b);
    }
  }
  return result;
}

/** The bridge receives a new allowlisted collection, never the full GIS snapshot. */
export function terrainTrails(snapshot: GisSnapshot | undefined) {
  const features =
    snapshot?.collection.features.filter((feature) => {
      const layer = snapshot.featureLayers.get(feature.id);
      return (
        layer?.layerType === 'trail' &&
        (feature.properties.feature_kind === 'trail' ||
          feature.properties.feature_kind === undefined) &&
        ['LineString', 'MultiLineString'].includes(feature.geometry.type)
      );
    }) ?? [];
  // Keep only the parts covered by the actual elevation subset.
  const covered = features.flatMap((feature) => {
    const lines =
      feature.geometry.type === 'LineString'
        ? [feature.geometry.coordinates]
        : feature.geometry.type === 'MultiLineString'
          ? feature.geometry.coordinates
          : [];
    const clipped = coveredLines(lines);
    if (!clipped.length) return [];
    return [
      {
        ...feature,
        geometry:
          clipped.length === 1
            ? { type: 'LineString' as const, coordinates: clipped[0] }
            : { type: 'MultiLineString' as const, coordinates: clipped },
      },
    ];
  });
  const result = trailPresentation({ type: 'FeatureCollection', features: covered });
  result.collection.features = result.collection.features.map((feature) => ({
    type: 'Feature',
    id: feature.id,
    geometry: feature.geometry,
    properties: {
      _display_trail_color: feature.properties._display_trail_color,
      _display_trail_casing: feature.properties._display_trail_casing,
      _display_trail_dashed: feature.properties._display_trail_dashed,
    },
  }));
  const payload = JSON.stringify(result.collection);
  if (payload.length > 500_000) throw new Error('3D trail budget exceeded');
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) hash = Math.imul(hash ^ payload.charCodeAt(i), 16777619);
  return { ...result, version: `${payload.length}-${hash >>> 0}` };
}

export type TerrainMessage =
  | { version: 1; session: string; type: 'ready'; startupMs: number }
  | { version: 1; session: string; type: 'error'; code: 'unsupported' | 'render' }
  | { version: 1; session: string; type: 'gesture' }
  | { version: 1; session: string; type: 'tiles'; status: 'loading' | 'ready' | 'unavailable' }
  | { version: 1; session: string; type: 'camera'; view: TerrainViewState };

export function parseTerrainMessage(raw: string, session: string): TerrainMessage | undefined {
  if (raw.length > 256) return;
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || value.session !== session) return;
    if (value.type === 'gesture') return value;
    if (value.type === 'tiles' && ['loading', 'ready', 'unavailable'].includes(value.status))
      return value;
    if (
      value.type === 'camera' &&
      value.view &&
      Array.isArray(value.view.center) &&
      insideTerrain(value.view.center) &&
      [value.view.zoom, value.view.bearing, value.view.pitch].every(Number.isFinite) &&
      value.view.zoom >= 14 &&
      value.view.zoom <= 19 &&
      Math.abs(value.view.bearing) <= 180 &&
      value.view.pitch >= 0 &&
      value.view.pitch <= 75
    )
      return value;
    if (
      value.type === 'ready' &&
      Number.isFinite(value.startupMs) &&
      value.startupMs >= 0 &&
      value.startupMs <= TERRAIN_STARTUP_TIMEOUT
    )
      return value;
    if (value.type === 'error' && ['unsupported', 'render'].includes(value.code)) return value;
  } catch {
    /* Ignore malformed/untrusted WebView messages. */
  }
}
