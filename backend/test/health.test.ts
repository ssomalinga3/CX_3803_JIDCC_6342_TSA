import request from 'supertest';
import { createApp } from '../src/app.js';

describe('GET /health', () => {
  const app = createApp();

  it('returns 200 with an ok status payload', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
    expect(typeof response.body.uptime).toBe('number');
    expect(typeof response.body.timestamp).toBe('string');
  });
});

describe('unknown routes', () => {
  const app = createApp();

  it('returns a 404 with the structured error envelope', async () => {
    const response = await request(app).get('/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
  });
});

describe('GET /ready', () => {
  it('confirms database readiness without caching the response', async () => {
    const response = await request(createApp({ checkReadiness: async () => {} })).get('/ready');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ status: 'ok', database: 'ok' });
  });

  it('redacts database failures and keeps liveness available', async () => {
    const app = createApp({
      checkReadiness: async () => {
        throw new Error('private connection string');
      },
    });
    const response = await request(app).get('/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is not ready', fields: {} },
    });
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('does not claim readiness without a database checker', async () => {
    expect((await request(createApp()).get('/ready')).status).toBe(503);
  });
});
