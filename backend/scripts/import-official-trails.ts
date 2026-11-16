import { importOfficialTrails, readOfficialTrails } from '../src/db/official-trails.js';
import { localDatabaseUrl } from './local-config.mjs';

try {
  const collection = readOfficialTrails();
  await importOfficialTrails(localDatabaseUrl(), collection);
  console.log(
    `Supplied trails imported (${collection.features.length} segments; landmarks preserved; safe to rerun).`,
  );
} catch {
  console.error(
    'Supplied trail import failed. Check trails.geojson, its source contract, PostGIS and migrations.',
  );
  process.exitCode = 1;
}
