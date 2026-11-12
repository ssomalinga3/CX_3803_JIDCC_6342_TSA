import { importPdfMap, readPdfMap } from '../src/db/pdf-map.js';
import { localDatabaseUrl } from './local-config.mjs';
try {
  const map = readPdfMap();
  await importPdfMap(localDatabaseUrl(), map);
  console.log(
    `Selected PDF map imported (${map.features.length} features, 6 layers; safe to rerun).`,
  );
} catch {
  console.error('PDF map import failed. Check the snapshot, PostGIS and migrations.');
  process.exitCode = 1;
}
