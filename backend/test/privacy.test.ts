import { mock } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('request error privacy', () => {
  afterEach(() => mock.restoreAll());

  it('does not echo or log malformed request bodies containing coordinates', async () => {
    const stderr = mock.method(process.stderr, 'write', () => true);
    const stdout = mock.method(process.stdout, 'write', () => true);
    const body = '{"latitude":33.123456,"longitude":-84.654321,"note":';
    const response = await request(createApp())
      .post('/api/v1/observations')
      .set('Content-Type', 'application/json')
      .send(body);
    // Express schedules default-handler logging after sending the response.
    await new Promise((resolve) => setImmediate(resolve));
    expect(response.status).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      error: { code: 'INVALID_JSON', message: 'Invalid JSON body', fields: {} },
    });
    expect(stderr.mock.calls.map((call) => String(call.arguments[0])).join('')).not.toMatch(
      /33\.123456|-84\.654321|SyntaxError|latitude/,
    );
    expect(stdout.mock.calls).toHaveLength(0);
  });

  it('does not echo oversized bodies', async () => {
    const response = await request(createApp())
      .post('/api/v1/observations')
      .send({ latitude: 33.123456, note: 'x'.repeat(110000) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(response.text).not.toContain('33.123456');
  });

  it('does not log coordinates from URLs, request bodies or dependency errors', async () => {
    const stderr = mock.method(process.stderr, 'write', () => true);
    const stdout = mock.method(process.stdout, 'write', () => true);
    const fail = async (): Promise<never> => {
      throw new Error('GPS 33.123456,-84.654321');
    };
    const app = createApp({
      checkReadiness: fail,
      layers: { listPublicLayers: fail, getPublicLayerFeatures: fail },
    });
    for (const path of ['/ready', '/api/v1/layers', '/api/v1/layers/test/features', '/unknown']) {
      const response = await request(app)
        .get(`${path}?location=33.123456,-84.654321`)
        .send({ latitude: 33.123456 });
      expect(response.text).not.toContain('33.123456');
    }
    expect(stderr.mock.calls.map((call) => String(call.arguments[0])).join('')).not.toMatch(
      /33\.123456|-84\.654321|SyntaxError|latitude/,
    );
    expect(stdout.mock.calls).toHaveLength(0);
  });
});
