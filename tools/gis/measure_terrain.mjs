/** Bounded-data parse/heap evidence in Node, separate from native rendering. */
import { readFileSync, statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
const root = new URL('../../', import.meta.url);
const text = readFileSync(new URL('data/cascade-springs-gis/terrain.geojson', root), 'utf8');
const data = JSON.parse(text);
const compact = JSON.stringify(data);
const assets = JSON.parse(
  readFileSync(new URL('mobile/assets/terrain/terrain-assets.json', root), 'utf8'),
);
const timings = [];
for (let i = 0; i < 101; i++) {
  const started = performance.now();
  JSON.parse(compact);
  timings.push(performance.now() - started);
}
global.gc?.();
const before = process.memoryUsage().heapUsed;
const parsed = JSON.parse(compact);
const allocated = process.memoryUsage().heapUsed - before;
timings.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      node: process.version,
      features: parsed.features.length,
      sources: Object.fromEntries(
        ['supplied', 'usgs'].map((key) => [
          key,
          data.features.filter((f) => f.properties.source_dataset === `csnp-terrain-${key}`).length,
        ]),
      ),
      source_file_bytes: statSync(new URL('data/cascade-springs-gis/terrain.geojson', root)).size,
      compact_response_bytes: Buffer.byteLength(compact),
      parse_median_ms: +timings[50].toFixed(3),
      parse_p95_ms: +timings[95].toFixed(3),
      parse_heap_allocation_bytes: allocated,
      gc_available: Boolean(global.gc),
      bundled_png_bytes: Object.values(assets).reduce((sum, a) => sum + a.bytes, 0),
      decoded_rgba_bytes: Object.values(assets).reduce((sum, a) => sum + a.width * a.height * 4, 0),
      limitation:
        'Desktop Node data-only observations; excludes native geometry/texture overhead and does not establish device startup or frame time.',
    },
    null,
    2,
  ),
);
