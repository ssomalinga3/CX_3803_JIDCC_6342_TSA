import { spawnSync } from 'node:child_process';
import { nodeToolCommand } from './process-tools.mjs';

const [tool, ...args] = process.argv.slice(2);
const env = { ...process.env };
if (tool === 'jest' && args[0] === '--integration') {
  args.shift();
  env.GIS_INTEGRATION = '1';
}
const command = nodeToolCommand(tool, args);
const result = spawnSync(command.file, command.args, { stdio: 'inherit', env });
if (result.error) console.error('Unable to start backend tool; install workspace dependencies');
process.exitCode = result.status ?? (result.signal === 'SIGINT' ? 130 : 1);
