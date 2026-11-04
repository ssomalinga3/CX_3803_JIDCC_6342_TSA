import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { localDatabaseUrl } from './local-config.mjs';

const url = new URL(localDatabaseUrl());
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  throw new Error('Fresh database checks require a loopback development database');
}
const database = `gis_test_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({ connectionString: url.toString() });
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  url.pathname = `/${database}`;
  const env = {
    ...process.env,
    DATABASE_URL: url.toString(),
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: url.toString(),
  };
  for (const command of [
    'db:migrate',
    'db:migrate',
    'db:seed',
    'db:seed',
    'test:integration',
    'test:worker',
  ]) {
    const result = spawnSync('pnpm', [command], { env, stdio: 'inherit' });
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
