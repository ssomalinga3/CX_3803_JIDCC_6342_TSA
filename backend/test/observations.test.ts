import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { localDatabaseUrl } from '../scripts/local-config.mjs';
import { createApp } from '../src/app.js';
import { withDatabase } from '../src/db/client.js';
import { observation, observationImage } from '../src/db/schema.js';
import { createLayersRepository } from '../src/modules/gis/layers.repo.js';
import {
  acceptObservation,
  type PreparedObservation,
} from '../src/modules/reports/observations.repo.js';

const integration = process.env.GIS_INTEGRATION === '1' ? describe : describe.skip;
integration('report persistence with real PostGIS', () => {
  const url = localDatabaseUrl();
  const submissions: string[] = [];

  function report(overrides: Partial<PreparedObservation> = {}): PreparedObservation {
    const id = randomUUID();
    submissions.push(id);
    return {
      clientSubmissionId: id,
      owner: { kind: 'guest', secretDigest: '1'.repeat(64) },
      payloadDigest: '2'.repeat(64),
      categoryId: 'test-erosion',
      capturedAt: new Date('2026-11-12T16:00:00Z'),
      location: { reason: 'not_shared' },
      destination: { mode: 'custom', recipients: ['recipient@example.test'] },
      objectKeys: [`private/${id}/0`, `private/${id}/1`],
      ...overrides,
    };
  }

  afterAll(async () => {
    if (submissions.length) {
      await withDatabase(url, (db) =>
        db.delete(observation).where(inArray(observation.clientSubmissionId, submissions)),
      );
    }
  });

  it('accepts one observation and ordered attachments across concurrent retries', async () => {
    const input = report({ location: { longitude: -84.4792, latitude: 33.7176 } });
    const results = await Promise.all([
      acceptObservation(url, input),
      acceptObservation(url, input),
    ]);
    expect(results.map(({ kind }) => kind).sort()).toEqual(['created', 'replay']);
    const receipts = results.flatMap((result) => ('receipt' in result ? [result.receipt] : []));
    expect(receipts).toHaveLength(2);
    expect(receipts[0]).toEqual(receipts[1]);
    const { rows, photos } = await withDatabase(url, async (db) => {
      const rows = await db
        .select()
        .from(observation)
        .where(eq(observation.clientSubmissionId, input.clientSubmissionId));
      const photos = await db
        .select()
        .from(observationImage)
        .where(eq(observationImage.observationId, rows[0]!.observationId))
        .orderBy(observationImage.position);
      return { rows, photos };
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deliveryMode: 'custom',
      recipients: ['recipient@example.test'],
    });
    expect(photos.map(({ objectKey }) => objectKey)).toEqual(input.objectKeys);
  });

  it('rejects cross-owner and conflicting retries without disclosing receipts', async () => {
    const input = report();
    expect((await acceptObservation(url, input)).kind).toBe('created');
    await expect(
      acceptObservation(url, { ...input, owner: { kind: 'guest', secretDigest: '3'.repeat(64) } }),
    ).resolves.toEqual({ kind: 'unavailable' });
    await expect(
      acceptObservation(url, { ...input, owner: { kind: 'account', accountId: 'other-account' } }),
    ).resolves.toEqual({ kind: 'unavailable' });
    await expect(
      acceptObservation(url, { ...input, payloadDigest: '4'.repeat(64) }),
    ).resolves.toEqual({ kind: 'conflict' });
  });

  it('rolls back the report when a photo reference fails and allows a clean retry', async () => {
    const input = report();
    await expect(
      acceptObservation(url, {
        ...input,
        objectKeys: [input.objectKeys[0]!, input.objectKeys[0]!],
      }),
    ).rejects.toThrow();
    const rows = await withDatabase(url, (db) =>
      db
        .select()
        .from(observation)
        .where(eq(observation.clientSubmissionId, input.clientSubmissionId)),
    );
    expect(rows).toEqual([]);
    expect((await acceptObservation(url, input)).kind).toBe('created');
  });

  it('keeps a persisted private report outside the public GIS catalog', async () => {
    const app = createApp({ layers: createLayersRepository(() => url) });
    const before = await request(app).get('/api/v1/layers').expect(200);
    const input = report({ note: 'private-report-test-marker' });
    expect((await acceptObservation(url, input)).kind).toBe('created');
    const after = await request(app).get('/api/v1/layers').expect(200);
    expect(after.body).toEqual(before.body);
    expect(after.text).not.toContain(input.clientSubmissionId);
  });
});
