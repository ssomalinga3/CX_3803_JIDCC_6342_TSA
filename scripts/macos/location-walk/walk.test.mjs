import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advance, createController, position, PRESERVE, simulatorAdapter } from './controller.mjs';
import { createPanel } from './server.mjs';

function harness() {
  let time = 0;
  const fixes = [];
  const clears = [];
  const adapter = {
    select: async () => ({ id: 'test-iphone', name: 'Test iPhone' }),
    set: async (device, point) => fixes.push({ device, point }),
    clear: async (device) => clears.push(device),
  };
  const controller = createController(adapter, () => time);
  return { controller, adapter, fixes, clears, elapse: (ms) => (time += ms) };
}

function separation(a, b) {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians;
  const dLon = (b.longitude - a.longitude) * radians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function nativeHarness(env = {}) {
  const calls = [];
  let androidList = 'List of devices attached\nemulator-5554\tdevice\nphysical-phone\tdevice\n';
  const execute = async (file, args) => {
    calls.push({ file, args });
    if (args.includes('devices') && file === 'xcrun')
      return {
        stdout: JSON.stringify({
          devices: { ios26: [{ udid: 'iphone', name: 'iPhone 17', state: 'Booted' }] },
        }),
      };
    if (args[0] === 'devices') return { stdout: androidList };
    if (args.includes('getprop')) return { stdout: '1\n' };
    return { stdout: 'OK\n' };
  };
  return {
    calls,
    execute,
    adapter: simulatorAdapter({ ANDROID_HOME: '/test/sdk', ...env }, execute),
    setAndroidList: (value) => (androidList = value),
  };
}

test('both mode publishes the same fix with each platform coordinate order and clears only iOS', async () => {
  const h = nativeHarness();
  const devices = await h.adapter.select('both');
  assert.equal(devices.targets.length, 2);
  await h.adapter.set(devices, PRESERVE);
  assert.ok(
    h.calls.some(({ args }) => args.join(' ') === 'simctl location iphone set 33.7176,-84.4792'),
  );
  assert.ok(
    h.calls.some(
      ({ file, args }) =>
        file === '/test/sdk/platform-tools/adb' &&
        args.join(' ') === '-s emulator-5554 emu geo fix -84.4792 33.7176',
    ),
  );
  h.calls.length = 0;
  await h.adapter.clear(devices);
  assert.deepEqual(
    h.calls.map(({ args }) => args),
    [['simctl', 'location', 'iphone', 'clear']],
  );
});

test('single-platform modes only discover selected tools and Android physical devices are excluded', async () => {
  const ios = nativeHarness();
  await ios.adapter.select('ios');
  assert.ok(ios.calls.every(({ file }) => file === 'xcrun'));
  const android = nativeHarness();
  await android.adapter.select('android');
  assert.ok(android.calls.every(({ file }) => file === '/test/sdk/platform-tools/adb'));
  android.setAndroidList('List of devices attached\nphysical-phone\tdevice\n');
  await assert.rejects(android.adapter.select('android'), /Boot one Android emulator/);
  const controller = createController(android.adapter);
  await assert.rejects(
    controller.command({ action: 'connect', platform: 'both' }),
    /Boot one Android/,
  );
  assert.equal(controller.state().device, null);
  assert.ok(android.calls.every(({ args }) => !args.includes('fix') && !args.includes('set')));
});

test('ambiguous Android emulators require an explicit serial', async () => {
  const h = nativeHarness();
  h.setAndroidList('emulator-5554\tdevice\nemulator-5556\tdevice\n');
  await assert.rejects(h.adapter.select('android'), /ANDROID_SERIAL/);
  const selected = nativeHarness({ ANDROID_SERIAL: 'emulator-5556' });
  selected.setAndroidList('emulator-5554\tdevice\nemulator-5556\tdevice\n');
  assert.equal((await selected.adapter.select('android')).targets[0].id, 'emulator-5556');
});

test('failed parallel native updates settle before disconnect; console KO errors are sanitized', async () => {
  const h = nativeHarness();
  let release;
  let didReject = false;
  const adapter = simulatorAdapter({}, async (file, args) => {
    if (args.includes('set')) throw new Error('private command arguments');
    if (args.includes('fix'))
      return new Promise((resolve) => (release = () => resolve({ stdout: 'OK' })));
    return h.execute(file, args);
  });
  const devices = await adapter.select('both');
  const pending = adapter.set(devices, PRESERVE).catch((error) => {
    didReject = true;
    assert.match(error.message, /^iOS simulator command failed/);
    assert.ok(!error.message.includes('private'));
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(didReject, false);
  release();
  await pending;
  const rejected = simulatorAdapter({}, async () => ({ stdout: 'KO: invalid coordinate value' }));
  await assert.rejects(
    rejected.set({ targets: [{ platform: 'android', id: 'emulator-5554' }] }, PRESERVE),
    /^Error: Android emulator command failed/,
  );
});

test('walking distance matches speed and diagonal input is normalized', async () => {
  const h = harness();
  await h.controller.command({ action: 'connect' });
  for (let i = 0; i < 20; i++) {
    await h.controller.command({ action: 'steer', east: 1, north: 1, speed: 1.4 });
    h.elapse(500);
    await h.controller.tick();
  }
  const state = h.controller.state();
  assert.ok(Math.abs(separation(PRESERVE, state.point) - 14) < 0.001);
  assert.ok(Math.abs(state.distance - 14) < 0.001);
  assert.ok(state.point.latitude > PRESERVE.latitude);
  assert.ok(state.point.longitude > PRESERVE.longitude);
  assert.equal(h.fixes.length, 21);
});

test('pause holds position with fresh fixes; lost heartbeat stops movement', async () => {
  const h = harness();
  await h.controller.command({ action: 'connect' });
  await h.controller.command({ action: 'steer', east: -1, north: 0, speed: 2 });
  h.elapse(500);
  await h.controller.tick();
  const point = h.controller.state().point;
  await h.controller.command({ action: 'pause' });
  h.elapse(500);
  await h.controller.tick();
  assert.ok(separation(point, h.controller.state().point) < 0.000001);
  assert.equal(h.fixes.length, 3);
  await h.controller.command({ action: 'steer', east: 1, north: 0, speed: 2 });
  h.elapse(2000);
  await h.controller.tick();
  assert.ok(separation(point, h.controller.state().point) < 0.000001);
  assert.equal(h.controller.state().vector.east, 0);
});

test('clear removes the fix and ticks cannot restart spoofing', async () => {
  const h = harness();
  await h.controller.command({ action: 'connect' });
  await h.controller.command({ action: 'clear' });
  h.elapse(500);
  await h.controller.tick();
  assert.equal(h.clears[0].id, 'test-iphone');
  assert.equal(h.fixes.length, 1);
  assert.equal(h.controller.state().device, null);
  await assert.rejects(h.controller.command({ action: 'steer', east: 1, north: 0, speed: 1.4 }));
});

test('teleport pauses walking and resets distance; rejects invalid inputs', async () => {
  const h = harness();
  await h.controller.command({ action: 'connect' });
  await h.controller.command({ action: 'steer', east: 1, north: 0, speed: 1 });
  const point = { latitude: 34, longitude: -84 };
  await h.controller.command({ action: 'position', point });
  h.elapse(500);
  await h.controller.tick();
  assert.ok(separation(point, h.controller.state().point) < 0.000001);
  assert.equal(h.controller.state().distance, 0);
  for (const value of [
    null,
    { latitude: NaN, longitude: 0 },
    { latitude: 86, longitude: 0 },
    { latitude: 0, longitude: 181 },
    { latitude: '33', longitude: 0 },
  ])
    assert.throws(() => position(value));
  for (const speed of [-1, Infinity, '2', 6])
    await assert.rejects(h.controller.command({ action: 'steer', east: 0, north: 1, speed }));
  await assert.rejects(h.controller.command({ action: 'steer', east: 2, north: 1, speed: 1 }));
  assert.ok(advance({ latitude: 0, longitude: 179.99999 }, 1, 0, 100).longitude < 0);
});

test('simulator failures stop updates and retain the device for clear/retry', async () => {
  const h = harness();
  await h.controller.command({ action: 'connect' });
  h.adapter.set = async () => {
    throw new Error('Simulator unavailable.');
  };
  h.elapse(500);
  await assert.rejects(h.controller.tick(), /Simulator unavailable/);
  assert.equal(h.controller.state().active, false);
  assert.equal(h.controller.state().device.id, 'test-iphone');
  await h.controller.tick();
  h.adapter.clear = async () => {
    throw new Error('Clear failed.');
  };
  await assert.rejects(h.controller.command({ action: 'clear' }));
  assert.equal(h.controller.state().device.id, 'test-iphone');
});

test('local HTTP panel requires token, validates origin/body and serializes clear after fixes', async (t) => {
  const h = harness();
  const { server, enqueue } = createPanel(h.controller, 'test-token');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${url}/`)).status, 200);
  assert.equal((await fetch(`${url}/session`)).status, 403);
  assert.equal(
    (
      await fetch(`${url}/session`, {
        headers: { 'X-Panel-Session': '1', Origin: 'https://example.com' },
      })
    ).status,
    403,
  );
  const session = await fetch(`${url}/session`, { headers: { 'X-Panel-Session': '1' } });
  assert.equal((await session.json()).token, 'test-token');
  assert.equal(session.headers.get('access-control-allow-origin'), null);
  assert.equal(
    (await fetch(`${url}/state`, { headers: { Authorization: 'Bearer stale-token' } })).status,
    403,
  );
  assert.equal((await fetch(`${url}/state`)).status, 403);
  assert.equal(
    (await fetch(`${url}/state`, { headers: { ...headers, Origin: 'https://example.com' } }))
      .status,
    403,
  );
  const post = (body) => fetch(`${url}/command`, { method: 'POST', headers, body });
  assert.equal((await post('{invalid')).status, 400);
  assert.equal((await post('null')).status, 400);
  assert.equal((await post('x'.repeat(4097))).status, 413);
  assert.equal((await post(JSON.stringify({ action: 'connect' }))).status, 200);
  let release;
  let entered;
  const started = new Promise((resolve) => (entered = resolve));
  h.adapter.set = async () => {
    entered();
    await new Promise((resolve) => (release = resolve));
  };
  const tick = enqueue(() => h.controller.tick());
  await started;
  const clear = enqueue(() => h.controller.command({ action: 'clear' }));
  assert.equal(h.clears.length, 0);
  release();
  await tick;
  await clear;
  assert.equal(h.clears.length, 1);
  const response = await fetch(`${url}/state`, { headers });
  assert.equal((await response.json()).active, false);
  assert.match(response.headers.get('cache-control'), /no-store/);
});
