import nodemailer from 'nodemailer';
import type { DeliveryOutcome, EmailAdapter } from './notification-delivery.js';

export function smtpOutcome(error: unknown): DeliveryOutcome {
  const details: { responseCode?: unknown; code?: unknown; command?: unknown } =
    error && typeof error === 'object' ? error : {};
  // These fail before any message is submitted, so they are configuration or provider
  // outages, not recipient rejections. Never mark the notification permanently failed.
  if (
    details.code === 'EAUTH' ||
    details.code === 'EDNS' ||
    (typeof details.command === 'string' && details.command.startsWith('MAIL FROM'))
  )
    return 'unavailable';
  const code = details.responseCode;
  if (typeof code === 'number' && code >= 400 && code < 500) return 'retry';
  if (typeof code === 'number' && code >= 500 && code < 600) return 'failed';
  return 'uncertain';
}

export function createSesSmtpAdapter(config: {
  host: string;
  username: string;
  password: string;
  sender: string;
}): EmailAdapter {
  if (
    !/^email-smtp\.[a-z0-9-]+\.amazonaws\.com$/.test(config.host) ||
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(config.sender) ||
    !config.username ||
    !config.password
  )
    throw new Error('Invalid SES SMTP configuration');
  const transport = nodemailer.createTransport({
    host: config.host,
    port: 465,
    secure: true,
    auth: { user: config.username, pass: config.password },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    async send(work) {
      try {
        await transport.sendMail({
          from: config.sender,
          to: work.recipient,
          envelope: { from: config.sender, to: [work.recipient] },
          messageId: `<${work.notificationId}@${config.sender.split('@')[1]}>`,
          subject: 'Cascade Springs observation',
          text: [
            'A visitor sent this private report to you.',
            `Report: ${work.observationId}`,
            `Category: ${work.categoryId}`,
            `Accepted: ${work.acceptedAt.toISOString()}`,
            '',
            work.note ?? '',
          ].join('\n'),
        });
        return 'delivered';
      } catch (error) {
        return smtpOutcome(error);
      }
    },
  };
}
