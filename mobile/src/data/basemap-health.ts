import type { StyleSpecification } from '@maplibre/maplibre-react-native';

import type { Basemap } from '@/data/basemaps';

export type BasemapView = { center: [number, number]; zoom: number };

async function checkedFetch(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  // Never include credential-bearing provider URLs or viewport coordinates in errors.
  if (!response.ok) throw new Error('Basemap resource unavailable');
  return response;
}

export function tileAt(template: string, view: BasemapView, maxZoom: number): string {
  const z = Math.max(0, Math.min(maxZoom, Math.floor(view.zoom)));
  const n = 2 ** z;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, view.center[1]));
  const radians = (latitude * Math.PI) / 180;
  const x = ((Math.floor(((view.center[0] + 180) / 360) * n) % n) + n) % n;
  const y = Math.min(
    n - 1,
    Math.max(0, Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * n)),
  );
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

async function nonempty(url: string, signal: AbortSignal) {
  const response = await checkedFetch(url, signal);
  const type = response.headers?.get('content-type') ?? '';
  if (/json|html/i.test(type)) throw new Error('Basemap resource invalid');
  if ((await response.arrayBuffer()).byteLength === 0) throw new Error('Basemap resource empty');
}

/** Check only the chosen provider, at the current viewport, once per deliberate attempt.
 * Native "fully rendered" can also fire for a blank/failed tile, especially on Android.
 * This detects HTTP auth/quota/tile/glyph failures without claiming exhaustive coverage.
 */
export async function checkBasemap(
  entry: Basemap,
  view: BasemapView,
  signal: AbortSignal,
): Promise<void> {
  // Preserve the existing offline pack path: online probes must not gate cached maps.
  if (entry.id === 'offline-prototype') return;
  const style: StyleSpecification =
    typeof entry.style === 'string'
      ? await (await checkedFetch(entry.style, signal)).json()
      : entry.style;
  if (style.version !== 8 || !style.sources || !Array.isArray(style.layers)) {
    throw new Error('Basemap style invalid');
  }
  const source =
    Object.values(style.sources).find((value) => value.type === 'vector') ??
    Object.values(style.sources).find((value) => value.type === 'raster');
  if (!source || (source.type !== 'vector' && source.type !== 'raster')) {
    throw new Error('Basemap source missing');
  }
  const glyphs = style.glyphs;
  if (typeof glyphs !== 'string' || !glyphs.startsWith('https://')) {
    throw new Error('Basemap glyphs missing');
  }
  const glyph = glyphs.replace('{fontstack}', 'Noto%20Sans%20Regular').replace('{range}', '0-255');
  const tileSource = source.url ? await (await checkedFetch(source.url, signal)).json() : source;
  const template = tileSource.tiles?.[0];
  if (typeof template !== 'string' || !template.startsWith('https://')) {
    throw new Error('Basemap tiles missing');
  }
  await Promise.all([
    nonempty(glyph, signal),
    nonempty(tileAt(template, view, tileSource.maxzoom ?? entry.nativeMaxZoom), signal),
  ]);
}
