import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import path from 'node:path';

export const PRESERVE = { latitude: 33.7176, longitude: -84.4792 };
const radians = Math.PI / 180;
const execute = promisify(execFile);

export function position(value) {
  if (
    !value ||
    !Number.isFinite(value.latitude) ||
    Math.abs(value.latitude) > 85 ||
    !Number.isFinite(value.longitude) ||
    Math.abs(value.longitude) > 180
  ) {
    throw new Error('Enter a latitude between -85 and 85 and longitude between -180 and 180.');
  }
  return { latitude: value.latitude, longitude: value.longitude };
}

// A spherical destination keeps diagonal speed constant and handles the date line.
export function advance(point, east, north, meters) {
  const distance = (Math.hypot(east, north) * meters) / 6371008.8;
  const bearing = Math.atan2(east, north);
  const lat = point.latitude * radians;
  const lon = point.longitude * radians;
  const nextLat = Math.asin(
    Math.sin(lat) * Math.cos(distance) + Math.cos(lat) * Math.sin(distance) * Math.cos(bearing),
  );
  const nextLon =
    lon +
    Math.atan2(
      Math.sin(bearing) * Math.sin(distance) * Math.cos(lat),
      Math.cos(distance) - Math.sin(lat) * Math.sin(nextLat),
    );
  return {
    latitude: Math.max(-85, Math.min(85, nextLat / radians)),
    longitude: ((((nextLon / radians + 180) % 360) + 360) % 360) - 180,
  };
}

export function simulatorAdapter(env = process.env, exec = execute) {
  const adb = path.join(
    env.ANDROID_HOME ?? path.join(homedir(), 'Library/Android/sdk'),
    'platform-tools/adb',
  );
  const run = async (platform, args) => {
    try {
      const { stdout } = await exec(
        platform === 'ios' ? 'xcrun' : adb,
        platform === 'ios' ? ['simctl', ...args] : args,
        {
          env: {
            ...env,
            DEVELOPER_DIR: env.DEVELOPER_DIR ?? '/Applications/Xcode.app/Contents/Developer',
          },
          timeout: 4000,
          killSignal: 'SIGKILL',
          maxBuffer: 1024 * 1024,
        },
      );
      // adb can exit successfully even when the emulator console rejects a command.
      if (platform === 'android' && /^KO:/m.test(stdout)) throw new Error();
      return stdout;
    } catch {
      // Never expose child-process errors: their command line contains the fix.
      throw new Error(
        `${platform === 'ios' ? 'iOS simulator' : 'Android emulator'} command failed. Check that the selected device is still booted.`,
      );
    }
  };
  async function selectIOS() {
    const result = JSON.parse(await run('ios', ['list', 'devices', 'booted', '--json']));
    const devices = Object.values(result.devices)
      .flat()
      .filter((device) => device.state === 'Booted');
    const device = env.IOS_SIMULATOR_UDID
      ? devices.find((item) => item.udid === env.IOS_SIMULATOR_UDID)
      : devices.length === 1
        ? devices[0]
        : undefined;
    if (!device)
      throw new Error('Boot one iOS simulator, or set IOS_SIMULATOR_UDID before starting.');
    return { platform: 'ios', id: device.udid, name: device.name };
  }
  async function selectAndroid() {
    const devices = (await run('android', ['devices']))
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter(([id, state]) => /^emulator-\d+$/.test(id) && state === 'device')
      .map(([id]) => id);
    const id = env.ANDROID_SERIAL
      ? devices.find((item) => item === env.ANDROID_SERIAL)
      : devices.length === 1
        ? devices[0]
        : undefined;
    if (!id) throw new Error('Boot one Android emulator, or set ANDROID_SERIAL before starting.');
    if ((await run('android', ['-s', id, 'shell', 'getprop', 'sys.boot_completed'])).trim() !== '1')
      throw new Error('Android is still booting. Wait for its Home screen.');
    return { platform: 'android', id, name: `Android (${id})` };
  }
  // Wait for every command before returning an error, so a late fix cannot race disconnect.
  async function all(operations) {
    const results = await Promise.allSettled(operations);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
  return {
    async select(platform = 'both') {
      const targets = [];
      if (platform !== 'android') targets.push(await selectIOS());
      if (platform !== 'ios') targets.push(await selectAndroid());
      return { targets, name: targets.map((target) => target.name).join(' + ') };
    },
    async set(device, point) {
      await all(
        device.targets.map((target) =>
          target.platform === 'ios'
            ? run('ios', ['location', target.id, 'set', `${point.latitude},${point.longitude}`])
            : run('android', [
                '-s',
                target.id,
                'emu',
                'geo',
                'fix',
                String(point.longitude),
                String(point.latitude),
              ]),
        ),
      );
    },
    async clear(device) {
      // Emulator geo fix has no clear operation; stop publishing and retain its last fix.
      await all(
        device.targets
          .filter((target) => target.platform === 'ios')
          .map((target) => run('ios', ['location', target.id, 'clear'])),
      );
    },
  };
}

// Call operations serially, including ticks, so clear cannot race a pending fix.
export function createController(adapter, now = () => performance.now()) {
  let point = { ...PRESERVE };
  let device = null;
  let active = false;
  let vector = { east: 0, north: 0 };
  let speed = 1.4;
  let lastInput = 0;
  let lastStep = now();
  let distance = 0;
  let error = '';
  const pause = () => {
    vector = { east: 0, north: 0 };
    lastStep = now();
  };
  const state = () => ({ point, device, active, vector, speed, distance, error });
  const publish = async () => {
    try {
      await adapter.set(device, point);
      error = '';
    } catch (failure) {
      active = false;
      pause();
      error = failure.message;
      throw failure;
    }
  };
  return {
    state,
    async command(input) {
      if (input.action === 'connect') {
        if (device) throw new Error('Disconnect the current simulation before connecting again.');
        const platform = input.platform ?? 'both';
        if (!['ios', 'android', 'both'].includes(platform))
          throw new Error('Choose iOS, Android or both.');
        device = await adapter.select(platform);
        pause();
        await publish();
        active = true;
      } else if (input.action === 'clear') {
        active = false;
        pause();
        if (device) await adapter.clear(device);
        device = null;
        error = '';
      } else if (input.action === 'pause') {
        pause();
      } else if (input.action === 'position') {
        const next = position(input.point);
        pause();
        point = next;
        distance = 0;
        if (active) await publish();
      } else if (input.action === 'steer') {
        if (!active) throw new Error('Connect to the simulator first.');
        if (
          !Number.isFinite(input.east) ||
          !Number.isFinite(input.north) ||
          Math.abs(input.east) > 1 ||
          Math.abs(input.north) > 1 ||
          !Number.isFinite(input.speed) ||
          input.speed < 0.2 ||
          input.speed > 5
        ) {
          throw new Error('Invalid direction or speed.');
        }
        const scale = Math.max(1, Math.hypot(input.east, input.north));
        vector = { east: input.east / scale, north: input.north / scale };
        speed = input.speed;
        lastInput = now();
      } else {
        throw new Error('Unknown command.');
      }
      return state();
    },
    async tick() {
      const time = now();
      const elapsed = Math.max(0, Math.min(1, (time - lastStep) / 1000));
      lastStep = time;
      if (!active) return;
      // A closed, hidden or disconnected panel cannot leave a walk running.
      if (time - lastInput > 1200) pause();
      point = advance(point, vector.east, vector.north, speed * elapsed);
      distance += Math.hypot(vector.east, vector.north) * speed * elapsed;
      await publish();
    },
  };
}
