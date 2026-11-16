import { importTerrainMap, readTerrainMap } from '../src/db/terrain-map.js';
import { localDatabaseUrl } from './local-config.mjs';
try {
  const map = readTerrainMap();
  await importTerrainMap(localDatabaseUrl(), map);
  console.log(
    `Terrain imported (${map.features.length} features, 2 source layers; safe to rerun).`,
  );
} catch {
  console.error('Terrain import failed. Check the versioned snapshot, bundled assets and PostGIS.');
  process.exitCode = 1;
}
