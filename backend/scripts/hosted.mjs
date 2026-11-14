import { URL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { hostedEnvironment } from './hosted-config.mjs';
import { pnpmCommand, stopProcessTree } from './process-tools.mjs';

const [script, ...args] = process.argv.slice(2);
const allowed = new Set(['db:migrate', 'db:check', 'db:import:source', 'dev']);
if (!allowed.has(script)) throw new Error('Unsupported hosted backend command');

const root = new URL('../../', import.meta.url);
const envFile = new URL(existsSync(new URL('.env', root)) ? '.env' : '.env.local', root);
const fileEnv = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const env = hostedEnvironment(fileEnv);
const command = pnpmCommand(['--dir', 'backend', script, ...args], env);
const child = spawn(command.file, command.args, {
  cwd: root,
  env,
  stdio: 'inherit',
  detached: process.platform !== 'win32',
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stopProcessTree(child, true));
}
child.on('error', () => {
  console.error('Unable to start hosted backend command');
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
});
