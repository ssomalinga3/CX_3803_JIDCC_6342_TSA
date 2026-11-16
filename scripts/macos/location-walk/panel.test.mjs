import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

test('plain URL bootstraps a session and an open panel recovers after a server restart', async () => {
  const elements = new Map();
  const intervals = [];
  const requests = [];
  let currentToken = 'first-server';
  let connected = false;
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, { value: id === 'platform' ? 'both' : '1.4', style: {} });
    return elements.get(id);
  };
  const response = (status, body) => ({ status, ok: status === 200, json: async () => body });
  runInNewContext(await readFile(new URL('panel.js', import.meta.url), 'utf8'), {
    document: {
      hidden: false,
      getElementById: element,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    window: { addEventListener: () => {} },
    // No fragment is needed; stale fragment links are deliberately ignored, too.
    location: { hash: '#stale-link-from-an-old-server' },
    AbortSignal,
    setInterval: (callback) => intervals.push(callback),
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url === '/session') {
        assert.equal(options.headers['X-Panel-Session'], '1');
        return response(200, { token: currentToken });
      }
      if (options.headers.Authorization !== `Bearer ${currentToken}`)
        return response(403, { error: 'Expired session' });
      if (url === '/command') {
        const command = JSON.parse(options.body);
        assert.equal(command.platform, 'both');
        assert.equal(command.action, 'connect');
        connected = true;
      }
      return response(200, {
        active: connected,
        device: connected ? { name: 'iOS + Android' } : null,
        point: { latitude: 33.7176, longitude: -84.4792 },
        vector: { east: 0, north: 0 },
        distance: 0,
        error: '',
      });
    },
  });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  await flush();
  assert.equal(element('device').textContent, 'Not connected');
  assert.equal(requests.filter(({ url }) => url === '/session').length, 1);
  // Restart before clicking Connect: the first POST is rejected without executing.
  currentToken = 'second-server';
  await element('connect').onclick();
  assert.equal(element('device').textContent, 'iOS + Android');
  assert.equal(element('connect').disabled, true);
  assert.equal(element('clear').disabled, false);
  assert.equal(element('error').textContent, '');
  assert.equal(requests.filter(({ url }) => url === '/command').length, 2);
  // A second restart while idle is recovered by the normal status poll.
  currentToken = 'third-server';
  connected = false;
  intervals[1]();
  await flush();
  assert.equal(element('device').textContent, 'Not connected');
  assert.equal(element('connect').disabled, false);
  assert.equal(requests.filter(({ url }) => url === '/session').length, 3);
});
