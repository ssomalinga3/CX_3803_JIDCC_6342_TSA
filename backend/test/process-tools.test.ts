import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { nodeToolCommand, pnpmCommand, stopProcessTree } from '../scripts/process-tools.mjs';

describe('portable backend processes', () => {
  const temporaryRoot = resolve(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, 'cascade-tooling-with spaces-'));
  const fixture = join(directory, 'fixture with spaces');

  afterAll(() => {
    const target = resolve(directory);
    if (
      !target.startsWith(temporaryRoot + sep) ||
      !basename(target).startsWith('cascade-tooling-')
    ) {
      throw new Error('Refusing to remove a directory outside the test fixture');
    }
    rmSync(target, { recursive: true, force: true });
  });

  it('runs the installed Jest CLI through Node', () => {
    const command = nodeToolCommand('jest', ['--version']);
    const result = spawnSync(command.file, command.args, { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^29\./);
  }, 60000);

  it('runs integration tests from a path with spaces without a shell assignment', () => {
    // A separate Jest fixture exercises the actual entry point and its env setup.
    const testPath = fixture + '.test.cjs';
    writeFileSync(
      testPath,
      `test('keeps arguments with spaces', () => {
      expect(process.env.GIS_INTEGRATION).toBe('1');
    });`,
    );
    const previousIntegration = process.env.GIS_INTEGRATION;
    const env = { ...process.env };
    delete env.GIS_INTEGRATION;
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../scripts/run-tool.mjs', import.meta.url)),
        'jest',
        '--integration',
        '--runInBand',
        '--json',
        '--testNamePattern',
        'keeps arguments with spaces',
        '--config',
        JSON.stringify({ rootDir: directory, testMatch: ['**/*.test.cjs'], transform: {} }),
      ],
      { cwd: directory, env, encoding: 'utf8', timeout: 55000 },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).numPassedTests).toBe(1);
    expect(process.env.GIS_INTEGRATION).toBe(previousIntegration);
  }, 60000);

  it('requires pnpm context rather than attempting a Windows batch shim', () => {
    expect(() => pnpmCommand([], {})).toThrow('Run this script through pnpm');
    expect(() => pnpmCommand([], { npm_execpath: 'pnpm.cmd' })).toThrow(
      'Run this script through pnpm',
    );
  });

  it('stops a spawned descendant server as well as its parent', async () => {
    const parentPath = join(directory, 'parent process.cjs');
    const serverCode = `const server = require('node:http').createServer((req,res) => res.end('ok'));
      server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({port:server.address().port,pid:process.pid})));`;
    writeFileSync(
      parentPath,
      `require('node:child_process').spawn(process.execPath,
      ['-e', ${JSON.stringify(serverCode)}], {stdio:['ignore','inherit','inherit']});
      setInterval(() => {}, 1000);`,
    );
    const parent = spawn(process.execPath, [parentPath], {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let descendantPid: number | undefined;
    try {
      const address = await new Promise<{ port: number; pid: number }>((resolveAddress, reject) => {
        let output = '';
        parent.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes('\n')) resolveAddress(JSON.parse(output.trim()));
        });
        parent.once('error', reject);
        parent.once('exit', () => reject(new Error('Fixture exited before listening')));
      });
      descendantPid = address.pid;
      const url = `http://127.0.0.1:${address.port}`;
      expect((await fetch(url)).status).toBe(200);
      stopProcessTree(parent, true);
      await once(parent, 'close', { signal: AbortSignal.timeout(10000) });
      await expect(fetch(url, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
    } finally {
      parent.kill();
      // Cleanup is independent of the assertion under test; only this fixture's PID.
      if (descendantPid) {
        try {
          process.kill(descendantPid, 'SIGTERM');
        } catch (error) {
          expect((error as NodeJS.ErrnoException).code).toBe('ESRCH');
        }
      }
    }
  }, 60000);
});
