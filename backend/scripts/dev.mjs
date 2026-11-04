import { spawn } from 'node:child_process';
import { localDatabaseUrl } from './local-config.mjs';

const bindingOverride = 'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE';
const child = spawn('pnpm', ['exec', 'wrangler', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    [bindingOverride]: process.env[bindingOverride] ?? localDatabaseUrl(),
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', () => {
  console.error('Unable to start Wrangler. Run pnpm install from the workspace root.');
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 0 : 1);
});
