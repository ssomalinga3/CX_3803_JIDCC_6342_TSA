import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { createApp } from './app.js';
import { checkDatabase } from './db/readiness.js';
import { createLayersRepository } from './modules/gis/layers.repo.js';
import { developmentReporting } from './modules/reports/development-reporting.js';

const app = createApp({
  layers: createLayersRepository(() => env.HYPERDRIVE.connectionString),
  checkReadiness: () => checkDatabase(env.HYPERDRIVE.connectionString),
  reporting: developmentReporting(
    env as unknown as Record<string, unknown>,
    () => env.HYPERDRIVE.connectionString,
  ),
});
app.listen(3000);

export default httpServerHandler({ port: 3000 });
