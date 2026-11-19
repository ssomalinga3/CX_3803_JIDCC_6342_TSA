import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { mock } from 'node:test';
import { eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { localDatabaseUrl } from '../scripts/local-config.mjs';
import { createApp } from '../src/app.js';
import { createLayersRepository } from '../src/modules/gis/layers.repo.js';
import { withDatabase } from '../src/db/client.js';
import {
  observation,
  observationImage,
  reportNotification,
  reportSubmission,
  reportUploadAttempt,
} from '../src/db/schema.js';
import {
  DEVELOPMENT_REPORT_CATEGORIES,
  reportMetadata,
  normalizedRecipient,
} from '../src/modules/reports/report-input.js';
import { type StoredPhoto, type PrivatePhotoStore } from '../src/modules/reports/photo-storage.js';
import {
  createSubmissionsRepository,
  type SubmissionsRepository,
} from '../src/modules/reports/submissions.repo.js';
import { createReportSubmissionService } from '../src/modules/reports/submissions.js';
import { pngWithChunk, sampleJpeg, samplePng } from './fixtures/photos.js';

/** Capture console as well as streams: Jest can buffer console calls until after a test. */
async function withoutPrivateOutput(action: () => Promise<void>) {
  const output = [
    mock.method(process.stdout, 'write', () => true),
    mock.method(process.stderr, 'write', () => true),
    ...(['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((method) =>
      mock.method(console, method, () => {}),
    ),
  ];
  try {
    await action();
    // Express's default logger can run after the response has been sent.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    for (const stream of output) stream.mock.restore();
  }
  for (const stream of output) expect(stream.mock.calls).toHaveLength(0);
}

function metadata() {
  return {
    client_submission_id: randomUUID(),
    category_id: 'dev-environmental',
    captured_at: '2026-11-18T12:00:00Z',
    location: null,
    location_unavailable_reason: 'not_shared',
    delivery_mode: 'custom',
    custom_recipients: [' Person@EXAMPLE.test ', 'Person@example.test', 'other@example.test'],
  };
}

describe('custom recipient input', () => {
  it('normalizes domains and duplicates, preserving mailbox local case', () => {
    expect(reportMetadata(metadata()).custom_recipients).toEqual([
      'Person@example.test',
      'other@example.test',
    ]);
    expect(normalizedRecipient('a+b@Example.test')).toBe('a+b@example.test');
  });
  it.each([
    'a@example.test\r\nBcc: other@example.test',
    'a..b@example.test',
    'Name <a@example.test>',
    'a@localhost',
    '@example.test',
    'a@-example.test',
  ])('rejects malformed recipients', (email) => {
    expect(() => normalizedRecipient(email)).toThrow('INVALID_REPORT');
  });
  it.each([
    { delivery_mode: 'park' },
    { custom_recipients: [] },
    { custom_recipients: Array(21).fill('a@example.test') },
    { captured_at: '2026-02-30T12:00:00Z' },
    { account_id: 'staff' },
    { location_unavailable_reason: undefined },
    { note: 'x'.repeat(2001) },
    { location: { type: 'Point', coordinates: [181, 0] }, location_unavailable_reason: undefined },
  ])('rejects invalid metadata', (change) => {
    expect(() => reportMetadata({ ...metadata(), ...change })).toThrow('INVALID_REPORT');
  });
});

const integration = process.env.GIS_INTEGRATION === '1' ? describe : describe.skip;
integration('custom report HTTP submission with real PostGIS', () => {
  const url = localDatabaseUrl();
  const ids: string[] = [];
  const baseRepository = createSubmissionsRepository(() => url, 120_000);
  beforeAll(async () => new Promise((resolve) => setImmediate(resolve)));
  function setup(repository: SubmissionsRepository = baseRepository) {
    const objects = new Map<string, StoredPhoto>();
    const store: PrivatePhotoStore = {
      put: jest.fn(async (key: string, photo: StoredPhoto) => {
        objects.set(key, photo);
      }),
      get: jest.fn(async (key: string) => objects.get(key) ?? null),
      delete: jest.fn(async (key: string) => {
        objects.delete(key);
      }),
    };
    const categories = [...DEVELOPMENT_REPORT_CATEGORIES];
    const service = createReportSubmissionService({
      repository,
      photos: store,
      categories,
      development: true,
    });
    const app = createApp({ reporting: service });
    const input = metadata();
    ids.push(input.client_submission_id);
    const secret = randomBytes(32).toString('hex');
    const post = (value: unknown = input, proof = secret, images: Buffer[] = [samplePng()]) => {
      const req = request(app)
        .post('/api/v1/observations')
        .set('Authorization', `Bearer ${proof}`)
        .field('metadata', JSON.stringify(value));
      for (const image of images)
        req.attach('images', image, { filename: 'untrusted.jpg', contentType: 'image/jpeg' });
      return req;
    };
    return { store, objects, service, app, input, secret, post, categories };
  }
  async function stored(id: string) {
    return withDatabase(url, async (db) => {
      const reports = await db
        .select()
        .from(observation)
        .where(eq(observation.clientSubmissionId, id));
      const attempts = await db
        .select()
        .from(reportUploadAttempt)
        .where(eq(reportUploadAttempt.clientSubmissionId, id));
      const photos = reports.length
        ? await db
            .select()
            .from(observationImage)
            .where(eq(observationImage.observationId, reports[0]!.observationId))
            .orderBy(observationImage.position)
        : [];
      const notifications = reports.length
        ? await db
            .select()
            .from(reportNotification)
            .where(eq(reportNotification.observationId, reports[0]!.observationId))
        : [];
      return { reports, attempts, photos, notifications };
    });
  }
  afterAll(async () => {
    if (!ids.length) return;
    await withDatabase(url, async (db) => {
      await db.delete(observation).where(inArray(observation.clientSubmissionId, ids));
      await db.delete(reportSubmission).where(inArray(reportSubmission.clientSubmissionId, ids));
    });
  });
  it('accepts private photos and atomically queues each normalized recipient once; replay survives catalog removal', async () => {
    const t = setup();
    const created = await t.post().expect(201).expect('Cache-Control', 'no-store');
    expect(Object.keys(created.body).sort()).toEqual([
      'accepted_at',
      'client_submission_id',
      'observation_id',
      'status',
    ]);
    expect(created.body.status).toBe('accepted');
    t.categories.splice(0);
    const replay = await t.post().expect(200);
    expect(replay.body).toEqual(created.body);
    expect(t.store.put).toHaveBeenCalledTimes(1);
    const result = await stored(t.input.client_submission_id);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]).toMatchObject({
      deliveryMode: 'custom',
      recipients: ['Person@example.test', 'other@example.test'],
      location: null,
      locationUnavailableReason: 'not_shared',
    });
    expect(result.reports[0]!.guestSecretDigest).not.toBe(t.secret);
    expect(result.photos.map((p) => p.objectKey)).toEqual([...t.objects.keys()]);
    expect(result.notifications.map((n) => [n.recipient, n.state, n.attempts]).sort()).toEqual([
      ['Person@example.test', 'pending', 0],
      ['other@example.test', 'pending', 0],
    ]);
    expect(result.attempts.map((a) => a.state)).toEqual(['accepted']);
    await t.post({ ...t.input, note: 'changed' }).expect(409);
    const denied = await t.post(t.input, 'f'.repeat(64)).expect(404);
    expect(denied.text).not.toContain(created.body.observation_id);
  });
  it('serializes in-flight retries without another upload or receipt', async () => {
    const t = setup();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    jest.mocked(t.store.put).mockImplementationOnce(async (key, photo) => {
      entered();
      await gate;
      t.objects.set(key, photo);
    });
    const first = t.post().then((r) => r);
    await started;
    try {
      const second = await t.post().expect(409).expect('Cache-Control', 'no-store');
      expect(second.body.error.code).toBe('SUBMISSION_IN_PROGRESS');
      expect(Number(second.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      release();
    }
    expect((await first).status).toBe(201);
    await t.post().expect(200);
    expect(t.store.put).toHaveBeenCalledTimes(1);
  });
  it('preserves multipart photo order and consented longitude/latitude', async () => {
    const t = setup();
    const input = {
      ...t.input,
      location: { type: 'Point', coordinates: [-84.4, 33.7] },
      location_unavailable_reason: undefined,
    };
    const images = [sampleJpeg(), samplePng()];
    await t.post(input, t.secret, images).expect(201);
    const state = await stored(t.input.client_submission_id);
    expect(state.photos.map((p) => t.objects.get(p.objectKey)!.sourceSha256)).toEqual(
      images.map((bytes) => createHash('sha256').update(bytes).digest('hex')),
    );
    expect(state.reports[0]!.locationUnavailableReason).toBeNull();
    const [point] = await withDatabase(url, (db) =>
      db
        .select({
          longitude: sql<number>`ST_X(${observation.location})`,
          latitude: sql<number>`ST_Y(${observation.location})`,
        })
        .from(observation)
        .where(eq(observation.clientSubmissionId, t.input.client_submission_id)),
    );
    expect(point).toEqual({ longitude: -84.4, latitude: 33.7 });
  });
  it('cleans a write with a lost acknowledgement and retries with a new attempt', async () => {
    const t = setup();
    jest.mocked(t.store.put).mockImplementationOnce(async (key, photo) => {
      t.objects.set(key, photo);
      throw new Error('private dependency details');
    });
    const failed = await t.post().expect(503);
    expect(failed.text).not.toContain('private dependency details');
    expect(t.objects.size).toBe(0);
    expect((await stored(t.input.client_submission_id)).reports).toEqual([]);
    await t.post().expect(201);
    expect(
      (await stored(t.input.client_submission_id)).attempts.map((a) => a.state).sort(),
    ).toEqual(['abandoned', 'accepted']);
  });
  it('keeps accepted objects after the database commit response is lost', async () => {
    const t = setup({
      ...baseRepository,
      async finish(...args) {
        await baseRepository.finish(...args);
        throw new Error('lost response');
      },
    });
    await t.post().expect(200);
    expect(t.objects.size).toBe(1);
    expect(t.store.delete).not.toHaveBeenCalled();
    expect((await stored(t.input.client_submission_id)).notifications).toHaveLength(2);
  });
  it('retains durable object intents when cleanup fails', async () => {
    const t = setup({
      ...baseRepository,
      async finish() {
        throw new Error('unavailable');
      },
    });
    jest.mocked(t.store.delete).mockRejectedValue(new Error('unavailable'));
    await t.post().expect(503);
    const state = await stored(t.input.client_submission_id);
    expect(state.reports).toEqual([]);
    expect(state.attempts[0]).toMatchObject({
      state: 'abandoned',
      objectKeys: [...t.objects.keys()],
    });
  });
  it('does not delete when acceptance cannot be reconciled', async () => {
    const t = setup({
      ...baseRepository,
      async finish() {
        throw new Error('unavailable');
      },
      async abandon() {
        throw new Error('unavailable');
      },
    });
    await t.post().expect(503);
    expect(t.store.delete).not.toHaveBeenCalled();
    expect(t.objects.size).toBe(1);
    expect((await stored(t.input.client_submission_id)).attempts[0]!.objectKeys).toEqual([
      ...t.objects.keys(),
    ]);
  });
  it('rolls back acceptance if durable notification insertion fails', async () => {
    const t = setup();
    const constraint = `test_outbox_${randomUUID().replaceAll('-', '')}`;
    const recipient = `${constraint}@example.test`;
    await withDatabase(url, (db) =>
      db.execute(
        sql.raw(
          `ALTER TABLE report_notification ADD CONSTRAINT ${constraint} CHECK (recipient <> '${recipient}')`,
        ),
      ),
    );
    try {
      await withoutPrivateOutput(async () => {
        const failure = await t.post({ ...t.input, custom_recipients: [recipient] }).expect(503);
        expect(failure.headers['cache-control']).toBe('no-store');
        expect(failure.body).toEqual({
          error: {
            code: 'REPORT_UNAVAILABLE',
            message: 'The report could not be accepted.',
            fields: {},
          },
        });
      });
      const state = await stored(t.input.client_submission_id);
      expect(state.reports).toEqual([]);
      expect(state.photos).toEqual([]);
      expect(state.notifications).toEqual([]);
      expect(state.attempts[0]!.state).toBe('abandoned');
      expect(t.objects.size).toBe(0);
    } finally {
      await withDatabase(url, (db) =>
        db.execute(sql.raw(`ALTER TABLE report_notification DROP CONSTRAINT ${constraint}`)),
      );
    }
  });
  it('reclaims expired attempts and prevents late object writes', async () => {
    const id = randomUUID();
    ids.push(id);
    const identity = {
      submissionId: id,
      guestDigest: '1'.repeat(64),
      payloadDigest: '2'.repeat(64),
    };
    const first = await baseRepository.begin(identity);
    if (!('attemptId' in first)) throw new Error('expected attempt');
    await withDatabase(url, (db) =>
      db
        .update(reportUploadAttempt)
        .set({ leaseExpiresAt: new Date(0) })
        .where(eq(reportUploadAttempt.attemptId, first.attemptId)),
    );
    const second = await baseRepository.begin(identity);
    expect(second).not.toEqual(first);
    await expect(baseRepository.recordObject(first.attemptId, randomUUID())).rejects.toThrow(
      'SUBMISSION_LEASE_EXPIRED',
    );
  });
  it('validates metadata and decoded content before writing photos', async () => {
    const t = setup();
    await t.post({ ...t.input, delivery_mode: 'park' }).expect(400);
    await t.post({ ...t.input, category_id: 'unknown' }).expect(400);
    await t.post().expect(409); // A rejected payload UUID remains reserved; correction needs a new UUID.
    const other = setup();
    await other.post(other.input, other.secret, [Buffer.from('not a JPEG')]).expect(415);
    expect(t.store.put).not.toHaveBeenCalled();
    expect(other.store.put).not.toHaveBeenCalled();
  });
  it('bounds multipart input and requires authorization', async () => {
    const t = setup();
    await request(t.app).post('/api/v1/observations').expect(401);
    await request(t.app)
      .post('/api/v1/observations')
      .set('Authorization', `Bearer ${t.secret}`)
      .send({})
      .expect(415);
    await t.post(t.input, t.secret, Array(4).fill(samplePng())).expect(400);
    await t.post(t.input, t.secret, [Buffer.alloc(5 * 1024 * 1024 + 1)]).expect(413);
    await t.post(t.input, t.secret, [Buffer.alloc(16 * 1024 * 1024)]).expect(413);
    await request(t.app)
      .post('/api/v1/observations')
      .set('Authorization', `Bearer ${t.secret}`)
      .set('Content-Type', 'multipart/form-data; boundary=broken')
      .send('malformed')
      .expect(400);
    expect(t.store.put).not.toHaveBeenCalled();
  });
  it('exposes only development options and leaves production reporting disabled', async () => {
    const t = setup();
    const options = await request(t.app).get('/api/v1/report-options').expect(200);
    expect(options.body).toEqual({
      development: true,
      delivery_modes: ['custom'],
      categories: DEVELOPMENT_REPORT_CATEGORIES,
    });
    expect(options.text).not.toContain('AWS');
    await request(createApp()).get('/api/v1/report-options').expect(404);
    await request(createApp()).post('/api/v1/observations').expect(404);
  });

  it('keeps submission validation and parser failures uncached and out of console/stream output', async () => {
    const t = setup();
    const privateMarker = 'private-report-body-marker';
    const input = {
      ...t.input,
      note: privateMarker,
      location: { type: 'Point', coordinates: [-122.654321, 47.123456] },
      location_unavailable_reason: undefined,
      custom_recipients: ['private-recipient@example.test'],
    };
    const image = pngWithChunk('tEXt', Buffer.from(`private-photo-marker\0${privateMarker}`));
    const post = () =>
      request(t.app)
        .post('/api/v1/observations?private=private-url-marker')
        .set('Authorization', `Bearer ${t.secret}`);
    await withoutPrivateOutput(async () => {
      const responses = [
        await request(t.app).post('/api/v1/observations').send(input),
        await post().send(input),
        await post().set('Content-Type', 'multipart/form-data').send(privateMarker),
        await post()
          .field('metadata', JSON.stringify(input).slice(0, -1))
          .attach('images', image, 'private-filename.png'),
        await post()
          .field('metadata', JSON.stringify(input))
          .field('metadata', JSON.stringify(input))
          .attach('images', image, 'private-filename.png'),
        await post()
          .field('metadata', JSON.stringify({ ...input, account_id: privateMarker }))
          .attach('images', image, 'private-filename.png'),
        await post()
          .field('metadata', JSON.stringify(input))
          .attach(
            'images',
            Buffer.alloc(5 * 1024 * 1024 + 1, privateMarker),
            'private-filename.png',
          ),
        await post()
          .set('Content-Type', 'multipart/form-data; boundary=private-boundary')
          .set('Content-Encoding', 'gzip')
          .send(privateMarker),
        await post()
          .field('metadata', JSON.stringify(input))
          .attach('images', Buffer.from(privateMarker), 'private-filename.png'),
        await post()
          .field('metadata', JSON.stringify(input))
          .attach('images', Buffer.alloc(16 * 1024 * 1024, privateMarker), 'private-filename.png'),
      ];
      expect(responses.map((r) => r.status)).toEqual([
        401, 415, 400, 400, 400, 400, 413, 415, 415, 413,
      ]);
      for (const response of responses) {
        expect(response.headers['cache-control']).toBe('no-store');
        expect(Object.keys(response.body)).toEqual(['error']);
        expect(Object.keys(response.body.error).sort()).toEqual(['code', 'fields', 'message']);
        for (const value of [
          privateMarker,
          'private-recipient@example.test',
          '-122.654321',
          '47.123456',
          t.secret,
          'private-photo-marker',
          'private-filename.png',
          'private-url-marker',
        ])
          expect(response.text).not.toContain(value);
      }
    });
    expect(t.store.put).not.toHaveBeenCalled();
  });

  it.each(['begin', 'recordObject', 'finish', 'abandon', 'upload', 'cleanup'] as const)(
    'redacts %s failures from responses and application output',
    async (stage) => {
      const dependencyMessage =
        'private-dependency-error recipient=private-recipient@example.test coordinates=-122.654321,47.123456 object=https://private.example.test/report-photo?signature=private-signature';
      const fail = async (): Promise<never> => {
        throw new Error(dependencyMessage);
      };
      const repository = { ...baseRepository };
      if (stage === 'begin') repository.begin = fail;
      if (stage === 'recordObject') repository.recordObject = fail;
      if (stage === 'finish' || stage === 'abandon' || stage === 'cleanup')
        repository.finish = fail;
      if (stage === 'abandon') repository.abandon = fail;
      const t = setup(repository);
      if (stage === 'upload') jest.mocked(t.store.put).mockImplementation(fail);
      if (stage === 'cleanup') jest.mocked(t.store.delete).mockImplementation(fail);
      const input = {
        ...t.input,
        custom_recipients: ['private-recipient@example.test'],
        note: 'private-note-marker',
      };
      await withoutPrivateOutput(async () => {
        const response = await t.post(input).expect(503).expect('Cache-Control', 'no-store');
        expect(response.body).toEqual({
          error: {
            code:
              stage === 'recordObject' || stage === 'upload'
                ? 'PHOTO_STORAGE_UNAVAILABLE'
                : 'REPORT_UNAVAILABLE',
            message: 'The report could not be accepted.',
            fields: {},
          },
        });
      });
      expect((await stored(t.input.client_submission_id)).reports).toEqual([]);
    },
  );

  it('keeps receipts and owner/payload rejection private and uncached', async () => {
    const t = setup();
    await withoutPrivateOutput(async () => {
      const first = await t.post().expect(201).expect('Cache-Control', 'no-store');
      const replay = await t.post().expect(200).expect('Cache-Control', 'no-store');
      expect(replay.body).toEqual(first.body);
      const denied = await t
        .post(t.input, 'f'.repeat(64))
        .expect(404)
        .expect('Cache-Control', 'no-store');
      const conflict = await t
        .post({ ...t.input, note: 'private-changed-note' })
        .expect(409)
        .expect('Cache-Control', 'no-store');
      expect(denied.body).toEqual({
        error: { code: 'NOT_FOUND', message: 'The report could not be accepted.', fields: {} },
      });
      expect(conflict.body).toEqual({
        error: {
          code: 'SUBMISSION_CONFLICT',
          message: 'The report could not be accepted.',
          fields: {},
        },
      });
      for (const response of [denied, conflict])
        expect(response.text).not.toContain(first.body.observation_id);
    });
  });

  it('never publishes custom reports, recipients or media through GIS or unimplemented staff/owner routes', async () => {
    const t = setup();
    const app = createApp({ reporting: t.service, layers: createLayersRepository(() => url) });
    const before = await request(app).get('/api/v1/layers').expect(200);
    const collections = new Map<string, unknown>();
    for (const layer of before.body.layers)
      collections.set(layer.layerId, (await request(app).get(layer.featuresUrl).expect(200)).body);
    const input = { ...t.input, note: 'private-visibility-marker' };
    const accepted = await t.post(input).expect(201);
    const state = await stored(input.client_submission_id);
    const key = state.photos[0]!.objectKey;
    const markers = [
      input.client_submission_id,
      accepted.body.observation_id,
      input.note,
      t.secret,
      key,
      ...state.reports[0]!.recipients,
    ];
    // These are hostile client claims, not authenticated staff sessions. Staff auth is not implemented.
    const claims = [
      {},
      { Authorization: 'Bearer unrelated-session', 'X-Role': 'Administrator' },
      { 'X-User-Role': 'Worker', 'X-Account-Id': 'park-admin' },
      { Authorization: `Bearer ${t.secret}` },
    ];
    await withoutPrivateOutput(async () => {
      for (const headers of claims) {
        const catalog = await request(app).get('/api/v1/layers').set(headers).expect(200);
        expect(catalog.body).toEqual(before.body);
        for (const layer of catalog.body.layers) {
          const collection = await request(app).get(layer.featuresUrl).set(headers).expect(200);
          expect(collection.body).toEqual(collections.get(layer.layerId));
          for (const marker of markers) expect(collection.text).not.toContain(marker);
        }
        for (const path of [
          '/api/v1/observations',
          '/api/v1/observations/export',
          `/api/v1/observations/${accepted.body.observation_id}`,
          `/api/v1/observations/${accepted.body.observation_id}/images`,
          `/api/v1/observations/${accepted.body.observation_id}/images/${key}`,
          `/api/v1/photos/${key}`,
          '/api/v1/staff/observations',
          '/api/v1/staff/observations/export',
          '/api/v1/notifications',
        ]) {
          const response = await request(app)
            .get(path)
            .set(headers)
            .expect(404)
            .expect('Cache-Control', 'no-store');
          expect(response.body).toEqual({
            error: { code: 'NOT_FOUND', message: 'Resource not found', fields: {} },
          });
        }
        await request(app)
          .patch(`/api/v1/observations/${accepted.body.observation_id}`)
          .set(headers)
          .send({ delivery_mode: 'park', status: 'resolved' })
          .expect(404)
          .expect('Cache-Control', 'no-store');
      }
    });
    expect(t.store.get).not.toHaveBeenCalled();
    const after = await stored(input.client_submission_id);
    expect(after).toEqual(state);
    expect(after.notifications.map((row) => row.recipient).sort()).toEqual(
      [...after.reports[0]!.recipients].sort(),
    );
  });
});
