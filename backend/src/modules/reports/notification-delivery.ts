export type NotificationWork = {
  notificationId: string;
  observationId: string;
  attemptId: string;
  recipient: string;
  categoryId: string;
  note: string | null;
  acceptedAt: Date;
  attempts: number;
};

/**
 * `unavailable` means the provider refused the sender before any message was
 * submitted (authentication, DNS or sender rejection). The work is released
 * without consuming an attempt and the run stops.
 */
export type DeliveryOutcome = 'delivered' | 'retry' | 'failed' | 'uncertain' | 'unavailable';
export interface EmailAdapter {
  send(work: NotificationWork): Promise<DeliveryOutcome>;
}
export interface NotificationRepository {
  claim(): Promise<NotificationWork | undefined>;
  complete(work: NotificationWork, outcome: DeliveryOutcome): Promise<void>;
}

/** A provider result and the database acknowledgement may both be lost. Never blindly resend. */
export async function deliverNext(
  repository: NotificationRepository,
  adapter: EmailAdapter,
): Promise<DeliveryOutcome | 'empty'> {
  const work = await repository.claim();
  if (!work) return 'empty';
  let outcome: DeliveryOutcome;
  try {
    outcome = await adapter.send(work);
  } catch {
    outcome = 'uncertain';
  }
  await repository.complete(work, outcome);
  return outcome;
}
