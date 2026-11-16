// Local tooling only. Reuse the API/database; never migrate, seed, build, or switch branches.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const toolsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = process.env.MOBILE_WORKTREE ? path.resolve(process.env.MOBILE_WORKTREE) : toolsRoot;
const [command = 'help', platform = 'both'] = process.argv.slice(2);
const port = process.env.METRO_PORT ?? '8082';
const app = JSON.parse(readFileSync(path.join(root, 'mobile/app.json'), 'utf8')).expo;
const sdk = process.env.ANDROID_HOME ?? path.join(homedir(), 'Library/Android/sdk');
const adb = path.join(sdk, 'platform-tools/adb');
const env = {
  ...process.env,
  DEVELOPER_DIR: process.env.DEVELOPER_DIR ?? '/Applications/Xcode.app/Contents/Developer',
  ANDROID_HOME: sdk,
};

function run(file, args, capture = true) {
  const result = spawnSync(file, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${file} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  }
  return result.stdout?.trim() ?? '';
}

function apiUrl() {
  let value = process.env.EXPO_PUBLIC_API_URL;
  // SDK 57's development virtual-env module merges these over the shell value.
  for (const file of ['.env', '.env.development', '.env.local', '.env.development.local']) {
    const name = path.join(root, 'mobile', file);
    if (existsSync(name)) value = parseEnv(readFileSync(name, 'utf8')).EXPO_PUBLIC_API_URL ?? value;
  }
  if (!value) throw new Error('Configure EXPO_PUBLIC_API_URL in mobile/.env.local first.');
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.pathname.replace(/\/$/, '') !== '/api/v1'
  ) {
    throw new Error('EXPO_PUBLIC_API_URL must be a public API base URL ending in /api/v1.');
  }
  return url;
}

async function checkHttp(url, expected) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).origin}`);
  const body = await response.text();
  if (!expected(body)) throw new Error(`Unexpected response from ${new URL(url).origin}`);
}

async function checkServers() {
  const api = apiUrl();
  await checkHttp(new URL('/ready', api), (body) => {
    const state = JSON.parse(body);
    return state.status === 'ok' && state.database === 'ok';
  });
  await checkHttp(`http://localhost:${port}/status`, (body) => body === 'packager-status:running');
  // Check project identity before opening an already-running Metro instance.
  const manifest = await (
    await fetch(`http://localhost:${port}/`, {
      headers: { 'expo-platform': 'ios' },
      signal: AbortSignal.timeout(5000),
    })
  ).json();
  if (manifest.extra?.expoClient?.extra?.eas?.projectId !== app.extra.eas.projectId) {
    throw new Error(`Metro on ${port} belongs to a different Expo project.`);
  }
  const projectRoot = manifest.extra?.expoClient?._internal?.projectRoot;
  if (projectRoot !== path.join(root, 'mobile')) {
    throw new Error(`Metro on ${port} belongs to a different checkout; use a free METRO_PORT.`);
  }
  const bundleHost = new URL(manifest.launchAsset.url).hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(bundleHost)) {
    throw new Error(
      'Start shared Metro with this helper so both simulators use a loopback bundle URL.',
    );
  }
  console.log(`API/database ready: ${api.origin}; Metro ready: ${port}`);
  return api;
}

function androidSerial() {
  const devices = run(adb, ['devices'])
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial.startsWith('emulator-') && state === 'device')
    .map(([serial]) => serial);
  const selected = process.env.ANDROID_SERIAL;
  if (selected) {
    if (!devices.includes(selected)) throw new Error('ANDROID_SERIAL is not a connected emulator.');
    return selected;
  }
  if (devices.length !== 1) throw new Error('Boot one Android emulator, or set ANDROID_SERIAL.');
  return devices[0];
}

async function main() {
  if (command !== 'help') {
    const branch = run('git', ['branch', '--show-current']) || 'detached';
    const commit = run('git', ['rev-parse', '--short', 'HEAD']);
    console.log(`Checkout: ${root} (${branch} @ ${commit})`);
  }
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('METRO_PORT must be between 1 and 65535.');
  }
  if (command === 'start') {
    const api = apiUrl();
    const node = readFileSync(path.join(root, '.nvmrc'), 'utf8').trim();
    const pnpm = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).packageManager;
    if (process.versions.node !== node || `pnpm@${run('pnpm', ['--version'])}` !== pnpm) {
      throw new Error('Use the repository-pinned Node and pnpm versions before starting Metro.');
    }
    env.REACT_NATIVE_PACKAGER_HOSTNAME = '127.0.0.1';
    // Keep Metro's listener consistent with the loopback URL in native manifests.
    env.NODE_OPTIONS = [env.NODE_OPTIONS, '--dns-result-order=ipv4first'].filter(Boolean).join(' ');
    const child = spawn('pnpm', ['mobile', '--localhost', '--port', port], {
      cwd: root,
      env,
      stdio: 'inherit',
    });
    // Reattach forwarding when the emulator reconnects while Metro remains open.
    const restoreForwarding = () => {
      try {
        const serial = androidSerial();
        run(adb, ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
        if (['localhost', '127.0.0.1', '[::1]'].includes(api.hostname)) {
          const apiPort = api.port || (api.protocol === 'https:' ? '443' : '80');
          run(adb, ['-s', serial, 'reverse', `tcp:${apiPort}`, `tcp:${apiPort}`]);
        }
      } catch {
        // iOS-only use and a temporarily disconnected emulator are supported.
      }
    };
    const forwarding = setInterval(restoreForwarding, 5000);
    forwarding.unref();
    restoreForwarding();
    child.on('error', (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    child.on('exit', (code) => {
      clearInterval(forwarding);
      process.exitCode = code ?? 1;
    });
    return;
  }
  if (command === 'open' || command === 'status') {
    if (!['both', 'android', 'ios'].includes(platform)) {
      throw new Error('Platform must be both, android, or ios.');
    }
    const api = await checkServers();
    if (platform !== 'ios') {
      const serial = androidSerial();
      if (run(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']) !== '1') {
        throw new Error('Android is still booting; wait for its Home screen.');
      }
      if (!run(adb, ['-s', serial, 'shell', 'pm', 'path', app.android.package])) {
        throw new Error('Install the Android development client before opening it.');
      }
      if (command === 'open') {
        run(adb, ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
        if (['localhost', '127.0.0.1', '[::1]'].includes(api.hostname)) {
          const apiPort = api.port || (api.protocol === 'https:' ? '443' : '80');
          run(adb, ['-s', serial, 'reverse', `tcp:${apiPort}`, `tcp:${apiPort}`]);
        }
        // Reopening a running SDK 57 client on another server can duplicate its React context.
        run(adb, ['-s', serial, 'shell', 'am', 'force-stop', app.android.package]);
        run(
          adb,
          [
            '-s',
            serial,
            'shell',
            'am',
            'start',
            '-W',
            '-a',
            'android.intent.action.VIEW',
            '-d',
            `${app.scheme}://expo-development-client/?url=${encodeURIComponent(`http://127.0.0.1:${port}`)}`,
            app.android.package,
          ],
          false,
        );
      }
      console.log(`Android ready: ${serial}`);
    }
    if (platform !== 'android') {
      const devices = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'booted', '--json']));
      const booted = Object.values(devices.devices)
        .flat()
        .filter((device) => device.state === 'Booted');
      const device = process.env.IOS_SIMULATOR_UDID
        ? booted.find((item) => item.udid === process.env.IOS_SIMULATOR_UDID)
        : booted.length === 1
          ? booted[0]
          : undefined;
      if (!device) throw new Error('Boot one iOS simulator, or set IOS_SIMULATOR_UDID.');
      run('xcrun', ['simctl', 'get_app_container', device.udid, app.ios.bundleIdentifier, 'app']);
      if (command === 'open') {
        run('xcrun', [
          'simctl',
          'openurl',
          device.udid,
          `${app.scheme}://expo-development-client/?url=${encodeURIComponent(`http://127.0.0.1:${port}`)}`,
        ]);
      }
      console.log(`iOS ready: ${device.name}`);
    }
    return;
  }
  if (command !== 'help') throw new Error(`Unknown command: ${command}`);
  console.log(
    'From the workspace root:\n  node scripts/macos/mobile-simulators.mjs start\n  node scripts/macos/mobile-simulators.mjs open [both|android|ios]\n  node scripts/macos/mobile-simulators.mjs status [both|android|ios]\nUse MOBILE_WORKTREE to select the checkout; METRO_PORT, ANDROID_SERIAL, IOS_SIMULATOR_UDID, or DEVELOPER_DIR for other overrides.',
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
