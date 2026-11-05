import { mock } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';

// Synthetic input only. No device location is collected by these tests.
const location = '33.123456,-84.654321';

describe('request error privacy (J6-15)', () => {
  // Let Node emit its VM-module startup warning before capturing request output.
  beforeAll(async () => new Promise((resolve) => setImmediate(resolve)));
  afterEach(() => mock.restoreAll());

  function captureOutput() {
    return {
      stdout: mock.method(process.stdout, 'write', () => true),
      stderr: mock.method(process.stderr, 'write', () => true),
    };
  }

  it.each([
    {
      name: 'malformed JSON',
      body: '{"latitude":33.123456,"longitude":-84.654321,"note":',
      contentType: 'application/json',
      status: 400,
      code: 'INVALID_JSON',
      message: 'Invalid JSON body',
    },
    {
      name: 'oversized JSON',
      body: JSON.stringify({ location, note: 'x'.repeat(110000) }),
      contentType: 'application/json',
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body is too large',
    },
    {
      name: 'unsupported JSON charset',
      body: JSON.stringify({ location }),
      contentType: 'application/json; charset=unsupported',
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Unsupported request encoding',
    },
  ])('redacts $name from responses and application output', async (testCase) => {
    const output = captureOutput();
    const response = await request(createApp())
      .post(`/unknown?location=${location}`)
      .set('Content-Type', testCase.contentType)
      .send(testCase.body);
    // Express's default error logger runs after sending the response.
    await new Promise((resolve) => setImmediate(resolve));
    expect(response.status).toBe(testCase.status);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      error: { code: testCase.code, message: testCase.message, fields: {} },
    });
    expect(output.stdout.mock.calls).toHaveLength(0);
    expect(output.stderr.mock.calls).toHaveLength(0);
  });

  it('keeps malformed route parameters as generic uncached client errors', async () => {
    const output = captureOutput();
    const response = await request(createApp()).get(
      `/api/v1/layers/%E0%A4%A/features?location=${location}`,
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(response.status).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      error: { code: 'INVALID_REQUEST', message: 'Invalid request', fields: {} },
    });
    expect(output.stdout.mock.calls).toHaveLength(0);
    expect(output.stderr.mock.calls).toHaveLength(0);
  });

  it('redacts unexpected handler failures without invoking the default logger', async () => {
    const output = captureOutput();
    mock.method(process, 'uptime', () => {
      throw new Error(`private-location=${location}`);
    });
    const response = await request(createApp()).get(`/health?location=${location}`);
    await new Promise((resolve) => setImmediate(resolve));
    expect(response.status).toBe(500);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Request could not be completed', fields: {} },
    });
    expect(output.stdout.mock.calls).toHaveLength(0);
    expect(output.stderr.mock.calls).toHaveLength(0);
  });

  it('keeps handled dependency failures and unknown URLs private', async () => {
    const output = captureOutput();
    const fail = async (): Promise<never> => {
      throw new Error(`private-location=${location}`);
    };
    const app = createApp({
      checkReadiness: fail,
      layers: { listPublicLayers: fail, getPublicLayerFeatures: fail },
    });
    for (const [path, status] of [
      ['/ready', 503],
      ['/api/v1/layers', 503],
      ['/api/v1/layers/example/features', 503],
      ['/unknown', 404],
    ] as const) {
      const response = await request(app).get(`${path}?location=${location}`);
      expect(response.status).toBe(status);
      expect(response.text.includes(location)).toBe(false);
    }
    await new Promise((resolve) => setImmediate(resolve));
    expect(output.stdout.mock.calls).toHaveLength(0);
    expect(output.stderr.mock.calls).toHaveLength(0);
  });
});
