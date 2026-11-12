import { URL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { importBoundaryMap } from '../src/db/boundary-map.js';
import { localDatabaseUrl } from './local-config.mjs';

try {
  const data: unknown = JSON.parse(
    await readFile(
      new URL('../../data/cascade-springs/approximate-boundary.geojson', import.meta.url),
      'utf8',
    ),
  );
  await importBoundaryMap(localDatabaseUrl(), data);
  console.log(
    'Cascade Springs selected PDF layers imported (legacy boundary command; safe to rerun).',
  );
} catch {
  console.error('Boundary import failed. Check the snapshot, PostGIS and migrations.');
  process.exitCode = 1;
}
