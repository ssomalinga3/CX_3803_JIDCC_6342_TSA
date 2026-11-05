import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

// Resolve from the backend package: works with isolated and hoisted installs.
export function nodeToolCommand(tool, args = []) {
  let cli;
  let nodeArgs = [];
  if (tool === 'jest') {
    cli = require.resolve('jest/bin/jest');
    nodeArgs = ['--experimental-vm-modules'];
  } else if (tool === 'drizzle-kit') {
    cli = join(dirname(require.resolve('drizzle-kit')), 'bin.cjs');
  } else if (tool === 'wrangler') {
    cli = join(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js');
  } else {
    throw new Error('Unsupported backend tool');
  }
  return { file: process.execPath, args: [...nodeArgs, cli, ...args] };
}

// pnpm supplies its actual CLI path to package scripts. Avoid launching a .cmd
// shim or interpolating arguments into a shell command on Windows.
export function pnpmCommand(args, env = process.env) {
  const cli = env.npm_execpath;
  if (!cli || /\.(cmd|bat)$/i.test(cli)) {
    throw new Error('Run this script through pnpm so its CLI path is available');
  }
  return /\.[cm]?js$/i.test(cli)
    ? { file: process.execPath, args: [cli, ...args] }
    : { file: cli, args };
}

// Only stop the tree/group that this script spawned, never a process by name.
export function stopProcessTree(child, group = false) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    if (result.status !== 0) throw new Error('Unable to stop the spawned process tree');
  } else {
    try {
      process.kill(group ? -child.pid : child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}
