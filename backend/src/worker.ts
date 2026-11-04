import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { createApp } from './app.js';
import { checkDatabase } from './db/readiness.js';
import { createLayersRepository } from './modules/gis/layers.repo.js';

const app = createApp({
  layers: createLayersRepository(() => env.HYPERDRIVE.connectionString),
  checkReadiness: () => checkDatabase(env.HYPERDRIVE.connectionString),
});
app.listen(3000);

export default httpServerHandler({ port: 3000 });
