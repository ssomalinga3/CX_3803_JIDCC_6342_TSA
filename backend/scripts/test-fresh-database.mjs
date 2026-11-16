import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { localDatabaseUrl } from './local-config.mjs';
import { pnpmCommand } from './process-tools.mjs';

const url = new URL(localDatabaseUrl());
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  throw new Error('Fresh database checks require a loopback development database');
}
const database = `gis_test_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({ connectionString: url.toString() });
// Validate the invocation before creating a disposable database.
pnpmCommand([]);
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  url.pathname = `/${database}`;
  const env = {
    ...process.env,
    GIS_SOURCE_MAP: '1',
    DATABASE_URL: url.toString(),
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: url.toString(),
  };
  for (const command of [
    'db:migrate',
    'db:migrate',
    'db:seed',
    'db:seed',
    'db:import:source',
    'db:import:source',
    'db:import:trails',
    'db:import:trails',
    'db:import:source',
    'db:import:pdf',
    'db:import:boundary',
    'db:import:terrain',
    'db:import:terrain',
    'db:import:source',
    'db:import:signal',
    'db:import:signal',
    'db:import:source',
    'test:integration',
    'test:worker',
  ]) {
    const invocation = pnpmCommand([command], env);
    const result = spawnSync(invocation.file, invocation.args, { env, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Fresh database check failed: ${command}`);
  }
  console.log('Fresh database migration, replay, seed and HTTP checks passed.');
} finally {
  try {
    if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
