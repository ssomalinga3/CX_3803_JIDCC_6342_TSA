import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { localDatabaseUrl } from '../scripts/local-config.mjs';
import { withDatabase } from '../src/db/client.js';
import { observation, reportNotification } from '../src/db/schema.js';
import { createNotificationRepository } from '../src/modules/reports/notifications.repo.js';

const integration = process.env.GIS_INTEGRATION === '1' ? describe : describe.skip;
integration('durable notification claims', () => {
  const url = localDatabaseUrl();
  const repository = createNotificationRepository(() => url);
  const ids: string[] = [];
  async function seed(mode: 'custom' | 'park' = 'custom') {
    const id = randomUUID();
    ids.push(id);
    return withDatabase(url, async (db) => {
      await db.insert(observation).values({
        observationId: id,
        clientSubmissionId: randomUUID(),
        guestSecretDigest: 'a'.repeat(64),
        payloadDigest: 'b'.repeat(64),
        categoryId: 'test-category',
        capturedAt: new Date(),
        locationUnavailableReason: 'not_shared',
        deliveryMode: mode,
        recipients: ['test@example.test'],
      });
      const [row] = await db
        .insert(reportNotification)
        .values({ observationId: id, recipient: 'test@example.test' })
        .returning();
      return row!;
    });
  }
  afterAll(async () => {
    if (ids.length)
      await withDatabase(url, (db) =>
        db.delete(observation).where(inArray(observation.observationId, ids)),
      );
  });
  it('claims a row once across concurrent senders and persists provider outcome', async () => {
    const seeded = await seed();
    const claims = await Promise.all([repository.claim(), repository.claim()]);
    const claimed = claims.filter((job) => job?.notificationId === seeded.notificationId);
    expect(claimed).toHaveLength(1);
    await repository.complete(claimed[0]!, 'delivered');
    const [row] = await withDatabase(url, (db) =>
      db
        .select()
        .from(reportNotification)
        .where(eq(reportNotification.notificationId, seeded.notificationId)),
    );
    expect(row).toMatchObject({ state: 'delivered', attempts: 1 });
    expect(row!.deliveredAt).toBeInstanceOf(Date);
  });
  it('releases unavailable-provider work without consuming an attempt', async () => {
    const seeded = await seed();
    let job = await repository.claim();
    while (job && job.notificationId !== seeded.notificationId) {
      await repository.complete(job, 'unavailable');
      job = await repository.claim();
    }
    expect(job?.notificationId).toBe(seeded.notificationId);
    await repository.complete(job!, 'unavailable');
    const [row] = await withDatabase(url, (db) =>
      db
        .select()
        .from(reportNotification)
        .where(eq(reportNotification.notificationId, seeded.notificationId)),
    );
    expect(row).toMatchObject({ state: 'pending', attempts: 0 });
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });
  it('holds an expired sender as uncertain without automatically retrying it', async () => {
    const seeded = await seed();
    await withDatabase(url, (db) =>
      db
        .update(reportNotification)
        .set({
          state: 'sending',
          leaseExpiresAt: sql`clock_timestamp() - interval '1 second'`,
          attemptId: randomUUID(),
        })
        .where(eq(reportNotification.notificationId, seeded.notificationId)),
    );
    await repository.claim();
    const [row] = await withDatabase(url, (db) =>
      db
        .select()
        .from(reportNotification)
        .where(eq(reportNotification.notificationId, seeded.notificationId)),
    );
    expect(row!.state).toBe('uncertain');
  });
  it('does not dispatch park-mode rows or custom destinations outside the accepted recipient list', async () => {
    const park = await seed('park');
    const custom = await seed();
    await withDatabase(url, (db) =>
      db
        .update(reportNotification)
        .set({ recipient: 'unlisted@example.test' })
        .where(eq(reportNotification.notificationId, custom.notificationId)),
    );
    const job = await repository.claim();
    expect(job?.notificationId).not.toBe(park.notificationId);
    expect(job?.notificationId).not.toBe(custom.notificationId);
  });
});
