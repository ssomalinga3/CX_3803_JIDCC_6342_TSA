import { spawn } from 'node:child_process';
import { localDatabaseUrl } from './local-config.mjs';
import { nodeToolCommand, stopProcessTree } from './process-tools.mjs';

const bindingOverride = 'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE';
const command = nodeToolCommand('wrangler', ['dev', ...process.argv.slice(2)]);
const child = spawn(command.file, command.args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    [bindingOverride]: process.env[bindingOverride] ?? localDatabaseUrl(),
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stopProcessTree(child));
}
child.on('error', () => {
  console.error('Unable to start Wrangler. Run pnpm install from the workspace root.');
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 0 : 1);
});
