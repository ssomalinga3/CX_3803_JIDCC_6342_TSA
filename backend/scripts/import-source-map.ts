import { URL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { importSourceMap } from '../src/db/source-map.js';
import { localDatabaseUrl } from './local-config.mjs';

try {
  const data: unknown = JSON.parse(
    await readFile(new URL('../../data/cascade-springs/features.geojson', import.meta.url), 'utf8'),
  );
  await importSourceMap(localDatabaseUrl(), data);
  console.log(
    'Cascade Springs selected sources imported (36 trails, 33 PDF/context features, 62 terrain features across two sources; safe to rerun).',
  );
} catch {
  console.error('Source map import failed. Check the snapshot, PostGIS and migrations.');
  process.exitCode = 1;
}
