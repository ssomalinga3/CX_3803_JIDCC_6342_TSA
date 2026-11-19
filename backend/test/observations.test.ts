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

  it('scopes account-owned receipts to the verified account', async () => {
    const input = report({ owner: { kind: 'account', accountId: 'report-test-owner' } });
    const created = await acceptObservation(url, input);
    expect(created.kind).toBe('created');
    const replay = await acceptObservation(url, input);
    expect(replay).toEqual({ ...created, kind: 'replay' });
    await expect(
      acceptObservation(url, { ...input, owner: { kind: 'account', accountId: 'other-account' } }),
    ).resolves.toEqual({ kind: 'unavailable' });
    await expect(
      acceptObservation(url, { ...input, owner: { kind: 'guest', secretDigest: '1'.repeat(64) } }),
    ).resolves.toEqual({ kind: 'unavailable' });
  });

  it('does not let a competing guest overwrite the winning submission', async () => {
    const input = report();
    const other = { ...input, owner: { kind: 'guest' as const, secretDigest: '3'.repeat(64) } };
    const inputs = [input, other];
    const results = await Promise.all(inputs.map((value) => acceptObservation(url, value)));
    expect(results.map(({ kind }) => kind).sort()).toEqual(['created', 'unavailable']);
    const winner = results.findIndex(({ kind }) => kind === 'created');
    const stored = await withDatabase(url, (db) =>
      db
        .select()
        .from(observation)
        .where(eq(observation.clientSubmissionId, input.clientSubmissionId)),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.guestSecretDigest).toBe(
      (inputs[winner]!.owner as { kind: 'guest'; secretDigest: string }).secretDigest,
    );
    expect(results[1 - winner]).toEqual({ kind: 'unavailable' });
  });

  it('retains the accepted destination and capture time when replay routing has changed', async () => {
    const input = report({ destination: { mode: 'park', recipient: 'original@example.test' } });
    const accepted = await acceptObservation(url, input);
    expect(accepted.kind).toBe('created');
    // The prepared payload digest excludes resolved server routing. A later configuration
    // change must not reroute or modify an already accepted, otherwise identical request.
    const replay = await acceptObservation(url, {
      ...input,
      destination: { mode: 'park', recipient: 'replacement@example.test' },
      objectKeys: ['private/retry-attempt/photo'],
    });
    expect(replay).toEqual({ ...accepted, kind: 'replay' });
    const stored = await withDatabase(url, (db) =>
      db
        .select()
        .from(observation)
        .where(eq(observation.clientSubmissionId, input.clientSubmissionId)),
    );
    expect(stored[0]).toMatchObject({
      recipients: ['original@example.test'],
      capturedAt: input.capturedAt,
      location: null,
      locationUnavailableReason: 'not_shared',
    });
    const photos = await withDatabase(url, (db) =>
      db
        .select()
        .from(observationImage)
        .where(eq(observationImage.observationId, stored[0]!.observationId))
        .orderBy(observationImage.position),
    );
    expect(photos.map(({ objectKey }) => objectKey)).toEqual(input.objectKeys);
    expect(Object.keys((replay as { receipt: object }).receipt).sort()).toEqual([
      'acceptedAt',
      'clientSubmissionId',
      'observationId',
    ]);
  });

  it.each([
    ['neither owner', { guestSecretDigest: null }],
    ['both owners', { accountId: 'report-test-owner' }],
    ['malformed guest digest', { guestSecretDigest: 'invalid' }],
    ['malformed payload digest', { payloadDigest: 'invalid' }],
    ['missing location explanation', { locationUnavailableReason: null }],
    ['unknown location explanation', { locationUnavailableReason: 'unknown' }],
    ['empty custom destinations', { recipients: [] }],
    ['empty recipient', { recipients: [''] }],
    [
      'multiple park destinations',
      { deliveryMode: 'park', recipients: ['a@test.invalid', 'b@test.invalid'] },
    ],
    ['unknown delivery mode', { deliveryMode: 'unknown' }],
  ] satisfies [string, Partial<typeof observation.$inferInsert>][])(
    'rejects invalid persisted state: %s',
    async (_name, invalid) => {
      const input = report();
      await expect(
        withDatabase(url, (db) =>
          db.insert(observation).values({
            clientSubmissionId: input.clientSubmissionId,
            guestSecretDigest: '1'.repeat(64),
            payloadDigest: input.payloadDigest,
            categoryId: input.categoryId,
            capturedAt: input.capturedAt,
            locationUnavailableReason: 'not_shared',
            deliveryMode: 'custom',
            recipients: ['recipient@example.test'],
            ...invalid,
          }),
        ),
      ).rejects.toThrow();
    },
  );

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
    for (const layer of after.body.layers) {
      const features = await request(app)
        .get(`/api/v1/layers/${layer.layerId}/features`)
        .expect(200);
      expect(features.text).not.toContain(input.clientSubmissionId);
      expect(features.text).not.toContain(input.note);
      expect(features.text).not.toContain('recipient@example.test');
      expect(features.text).not.toContain('guest_secret_digest');
    }
  });
});
