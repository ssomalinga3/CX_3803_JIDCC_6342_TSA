import { seedDemo } from '../src/db/demo-seed.js';
import { localDatabaseUrl } from './local-config.mjs';

try {
  await seedDemo(localDatabaseUrl());
  console.log('Synthetic public GIS demo fixtures seeded (safe to rerun).');
} catch {
  console.error('Demo seed failed. Start PostGIS and apply migrations first.');
  process.exitCode = 1;
}
