import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createController, simulatorAdapter } from './controller.mjs';

export function createPanel(controller, token) {
  let pending = Promise.resolve();
  const enqueue = (operation) => {
    const next = pending.then(operation);
    pending = next.catch(() => {});
    return next;
  };
  const files = {
    '/': ['panel.html', 'text/html'],
    '/panel.js': ['panel.js', 'text/javascript'],
    '/panel.css': ['panel.css', 'text/css'],
  };
  const server = createServer(async (request, response) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const reply = (status, body, type = 'application/json') => {
      response.writeHead(status, {
        'Content-Type': `${type}; charset=utf-8`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      });
      response.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    if (
      request.headers.host !== new URL(origin).host ||
      (request.headers.origin && request.headers.origin !== origin)
    ) {
      reply(403, { error: 'Use the local panel URL printed in the terminal.' });
      return;
    }
    try {
      if (request.method === 'GET' && Object.hasOwn(files, request.url)) {
        const [file, type] = files[request.url];
        reply(200, await readFile(new URL(file, import.meta.url)), type);
        return;
      }
      // A custom header requires a CORS preflight from another origin. We never
      // allow CORS, so only this local page can bootstrap its current session.
      if (request.method === 'GET' && request.url === '/session') {
        if (request.headers['x-panel-session'] !== '1') {
          reply(403, { error: 'Open the local walking panel to connect.' });
        } else {
          reply(200, { token });
        }
        return;
      }
      if (request.headers.authorization !== `Bearer ${token}`) {
        reply(403, { error: 'Panel session expired. Reconnect from the local walking panel.' });
        return;
      }
      if (request.method === 'GET' && request.url === '/state') {
        reply(200, controller.state());
      } else if (request.method === 'POST' && request.url === '/command') {
        if (request.headers['content-type'] !== 'application/json') {
          reply(415, { error: 'Expected JSON.' });
          return;
        }
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 4096) {
            reply(413, { error: 'Command too large.' });
            return;
          }
        }
        let input;
        try {
          input = JSON.parse(body);
        } catch {
          reply(400, { error: 'Invalid JSON.' });
          return;
        }
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          reply(400, { error: 'Expected a command object.' });
          return;
        }
        reply(200, await enqueue(() => controller.command(input)));
      } else {
        reply(404, { error: 'Not found.' });
      }
    } catch (error) {
      reply(400, { error: error.message });
    }
  });
  server.requestTimeout = 5000;
  return { server, enqueue };
}

async function main() {
  const port = Number(process.env.LOCATION_WALK_PORT ?? 8766);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('LOCATION_WALK_PORT must be between 1 and 65535.');
  }
  const token = randomBytes(24).toString('hex');
  const controller = createController(simulatorAdapter());
  const { server, enqueue } = createPanel(controller, token);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`GPS walking panel: http://127.0.0.1:${port}/`);
  console.log('Boot iOS/Android, open the panel, and choose your targets. Ctrl+C disconnects.');
  let stopping = false;
  let timer;
  const tick = async () => {
    try {
      await enqueue(() => controller.tick());
    } catch {
      // The panel displays the fixed simulator error; never log coordinates.
    }
    if (!stopping) timer = setTimeout(tick, 500);
  };
  timer = setTimeout(tick, 500);
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    server.close();
    try {
      await enqueue(() => controller.command({ action: 'clear' }));
    } catch {
      console.error('Could not clear iOS spoofing. Use Simulator → Features → Location → None.');
      process.exitCode = 1;
    }
    server.closeAllConnections();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(
      'Could not start the panel. Check LOCATION_WALK_PORT and whether it is already in use.',
    );
    process.exitCode = 1;
  });
}
