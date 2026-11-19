import {
  deliverNext,
  type NotificationWork,
} from '../src/modules/reports/notification-delivery.js';
import { jest } from '@jest/globals';
import { smtpOutcome } from '../src/modules/reports/smtp-email.js';

const work: NotificationWork = {
  notificationId: 'notification',
  observationId: 'observation',
  attemptId: 'attempt',
  recipient: 'private@example.test',
  categoryId: 'dev-environmental',
  note: 'private note',
  acceptedAt: new Date(),
  attempts: 1,
};

it('dispatches only claimed work and stores delivery separately from acceptance', async () => {
  const repository = {
    claim: jest.fn(async (): Promise<NotificationWork | undefined> => work),
    complete: jest.fn(async () => {}),
  };
  const adapter = { send: jest.fn(async () => 'delivered' as const) };
  await expect(deliverNext(repository, adapter)).resolves.toBe('delivered');
  expect(adapter.send).toHaveBeenCalledWith(work);
  expect(repository.complete).toHaveBeenCalledWith(work, 'delivered');
  repository.claim.mockResolvedValue(undefined);
  await expect(deliverNext(repository, adapter)).resolves.toBe('empty');
  expect(adapter.send).toHaveBeenCalledTimes(1);
});

it('holds ambiguous provider failures for reconciliation', async () => {
  const repository = { claim: jest.fn(async () => work), complete: jest.fn(async () => {}) };
  await expect(
    deliverNext(repository, {
      send: async () => {
        throw new Error('private provider text');
      },
    }),
  ).resolves.toBe('uncertain');
  expect(repository.complete).toHaveBeenCalledWith(work, 'uncertain');
});

it('retries explicit temporary SMTP rejections and holds lost acknowledgements', () => {
  expect(smtpOutcome({ responseCode: 451 })).toBe('retry');
  expect(smtpOutcome({ responseCode: 550 })).toBe('failed');
  expect(smtpOutcome({ code: 'ETIMEDOUT' })).toBe('uncertain');
});
