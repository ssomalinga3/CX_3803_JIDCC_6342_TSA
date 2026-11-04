import { checkDatabase } from '../src/db/readiness.js';
import { localDatabaseUrl } from './local-config.mjs';

try {
  await checkDatabase(localDatabaseUrl());
  console.log('Database connection, Drizzle, and PostGIS are ready.');
} catch {
  console.error('Database check failed. Start Docker, run db:up, then db:migrate.');
  process.exitCode = 1;
}
