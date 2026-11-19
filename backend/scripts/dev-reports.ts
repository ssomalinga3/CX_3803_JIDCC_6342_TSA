import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { s3PhotoConfig } from '../src/modules/reports/s3-photo-store.js';
import { localDatabaseUrl } from './local-config.mjs';
import { nodeToolCommand, stopProcessTree } from './process-tools.mjs';

// Dedicated local Worker. Keep secrets out of argv, output, source files and deployment config.
const port = Number(process.env.REPORTING_PORT ?? '8787');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid reporting port');
const database = localDatabaseUrl();
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(database).hostname))
  throw new Error('Local reporting requires a loopback database');
const config = s3PhotoConfig(process.env);
const probe = createServer();
await new Promise<void>((resolve, reject) => {
  probe.once('error', () => reject(new Error('Reporting port is already in use or unavailable')));
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
});
const temporary = await mkdtemp(path.join(tmpdir(), 'cascade-report-dev-'));
let child: ReturnType<typeof spawn> | undefined;
try {
  await writeFile(
    path.join(temporary, 'wrangler.json'),
    JSON.stringify({
      name: 'cascade-report-development',
      main: fileURLToPath(new URL('../src/worker.ts', import.meta.url)),
      compatibility_date: '2026-10-23',
      compatibility_flags: ['nodejs_compat'],
      hyperdrive: [{ binding: 'HYPERDRIVE', id: '00000000000000000000000000000000' }],
    }),
    { mode: 0o600 },
  );
  const values = {
    REPORTING_MODE: 'custom-development',
    AWS_REGION: config.region,
    S3_BUCKET: config.bucket,
    AWS_ACCESS_KEY_ID: config.accessKeyId,
    AWS_SECRET_ACCESS_KEY: config.secretAccessKey,
    ...(config.sessionToken ? { AWS_SESSION_TOKEN: config.sessionToken } : {}),
  };
  await writeFile(
    path.join(temporary, '.dev.vars'),
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
  const command = nodeToolCommand('wrangler', [
    'dev',
    '--local',
    '--config',
    path.join(temporary, 'wrangler.json'),
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--persist-to',
    path.join(temporary, 'state'),
  ]);
  child = spawn(command.file, command.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: database,
    },
  });
  // Do not forward Wrangler binding diagnostics or request output containing private context.
  child.stdout?.resume();
  child.stderr?.resume();
  let failed = false;
  child.on('error', () => {
    failed = true;
  });
  let stopping = false;
  const stop = () => {
    stopping = true;
    if (child) stopProcessTree(child, true);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (failed || child.exitCode !== null || stopping) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/report-options`, {
        signal: AbortSignal.timeout(1000),
      });
      if (
        response.ok &&
        ((await response.json()) as { development?: boolean }).development === true
      ) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the runtime to bind. */
    }
    await delay(250);
  }
  if (!ready) throw new Error('LOCAL_REPORT_WORKER_FAILED');
  const databaseReady = await fetch(`http://127.0.0.1:${port}/ready`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!databaseReady.ok) throw new Error('LOCAL_REPORT_DATABASE_NOT_READY');
  console.log(`Custom-recipient development Worker ready: http://127.0.0.1:${port}`);
  console.log(
    'Development categories; photos use private S3; notifications remain queued. No SMTP sender is running.',
  );
  await once(child, 'exit');
  if (!stopping && child.exitCode !== 0) process.exitCode = 1;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    stopProcessTree(child, true);
    await Promise.race([exited, delay(5000)]);
  }
  await rm(temporary, { recursive: true, force: true });
}
