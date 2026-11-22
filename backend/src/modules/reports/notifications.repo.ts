import { randomUUID } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import { withDatabase } from '../../db/client.js';
import { reportNotification } from '../../db/schema.js';
import type { NotificationRepository, NotificationWork } from './notification-delivery.js';

export function createNotificationRepository(
  connectionString: () => string,
): NotificationRepository {
  return {
    async claim() {
      return withDatabase(connectionString(), (db) =>
        db.transaction(async (tx) => {
          // A crashed/expired sender may have reached SMTP. Keep it for operator reconciliation.
          await tx
            .update(reportNotification)
            .set({ state: 'uncertain' })
            .where(
              and(
                eq(reportNotification.state, 'sending'),
                lt(reportNotification.leaseExpiresAt, sql`clock_timestamp()`),
              ),
            );
          const attemptId = randomUUID();
          const result = await tx.execute(sql`
          WITH candidate AS (
            SELECT n.notification_id FROM report_notification n
            JOIN observation o ON o.observation_id = n.observation_id
            WHERE n.state = 'pending' AND n.next_attempt_at <= clock_timestamp()
              AND o.delivery_mode = 'custom' AND n.recipient = ANY(o.recipients)
            ORDER BY n.created_at, n.notification_id
            FOR UPDATE OF n SKIP LOCKED LIMIT 1
          )
          UPDATE report_notification n SET state = 'sending', attempts = attempts + 1,
            attempt_id = ${attemptId}::uuid,
            lease_expires_at = clock_timestamp() + interval '5 minutes'
          FROM candidate c, observation o
          WHERE n.notification_id = c.notification_id AND o.observation_id = n.observation_id
          RETURNING n.notification_id AS "notificationId", n.observation_id AS "observationId",
            n.attempt_id AS "attemptId", n.recipient, n.attempts,
            o.category_id AS "categoryId", o.note, o.accepted_at AS "acceptedAt"
        `);
          return result.rows[0] as NotificationWork | undefined;
        }),
      );
    },
    async complete(work, outcome) {
      const released = outcome === 'unavailable';
      const retry = outcome === 'retry' && work.attempts < 5;
      const delaySeconds = released ? 300 : Math.min(3600, 30 * 2 ** work.attempts);
      await withDatabase(connectionString(), async (db) => {
        await db
          .update(reportNotification)
          .set({
            state: released || retry ? 'pending' : outcome === 'retry' ? 'failed' : outcome,
            // A release never reached the provider, so it does not count as an attempt.
            ...(released ? { attempts: sql`${reportNotification.attempts} - 1` } : {}),
            nextAttemptAt: sql`clock_timestamp() + (${delaySeconds} * interval '1 second')`,
            deliveredAt: outcome === 'delivered' ? sql`clock_timestamp()` : null,
            leaseExpiresAt: null,
          })
          .where(
            and(
              eq(reportNotification.notificationId, work.notificationId),
              eq(reportNotification.attemptId, work.attemptId),
              eq(reportNotification.state, 'sending'),
            ),
          );
      });
    },
  };
}
