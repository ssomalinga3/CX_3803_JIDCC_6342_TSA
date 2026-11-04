import { defineConfig } from 'drizzle-kit';
import { localDatabaseUrl } from './scripts/local-config.mjs';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: localDatabaseUrl() },
});
