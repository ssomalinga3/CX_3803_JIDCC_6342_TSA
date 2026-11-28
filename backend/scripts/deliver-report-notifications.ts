import { localDatabaseUrl } from './local-config.mjs';
import { createNotificationRepository } from '../src/modules/reports/notifications.repo.js';
import { deliverNext } from '../src/modules/reports/notification-delivery.js';
import { createSesSmtpAdapter } from '../src/modules/reports/smtp-email.js';

// Explicit operator invocation. Credentials stay in backend-only environment configuration.
if (process.argv.slice(2).join(' ') !== '--send') {
  console.log(
    'Use reports:deliver --send with approved SES SMTP configuration to dispatch pending notifications.',
  );
} else {
  try {
    const adapter = createSesSmtpAdapter({
      host: process.env.SES_SMTP_HOST ?? '',
      username: process.env.SES_SMTP_USERNAME ?? '',
      password: process.env.SES_SMTP_PASSWORD ?? '',
      sender: process.env.REPORT_EMAIL_FROM ?? '',
    });
    const repository = createNotificationRepository(localDatabaseUrl);
    for (let index = 0; index < 20; index += 1) {
      const outcome = await deliverNext(repository, adapter);
      console.log(`Notification result: ${outcome}`);
      if (outcome === 'empty') break;
      if (outcome === 'unavailable') {
        console.error(
          'SES SMTP refused the sender before submission. Check the backend-only configuration.',
        );
        process.exitCode = 1;
        break;
      }
    }
  } catch {
    console.error(
      'Notification dispatch could not complete. Inspect durable delivery states before retrying.',
    );
    process.exitCode = 1;
  }
}
