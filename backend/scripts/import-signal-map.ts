import { importSignalMap, readSignalMap } from '../src/db/signal-map.js';
import { localDatabaseUrl } from './local-config.mjs';
try {
  const map = readSignalMap();
  await importSignalMap(localDatabaseUrl(), map);
  console.log(`Signal observations imported (${map.features.length} features; safe to rerun).`);
} catch {
  console.error('Signal import failed. Check the reviewed snapshot, class contract and PostGIS.');
  process.exitCode = 1;
}
