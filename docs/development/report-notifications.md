# Custom-recipient email delivery (J6-32)

The owner selected custom recipients first on November 19, 2026. The existing
acceptance transaction creates one durable notification per explicit recipient.
The dispatcher claims only custom-mode rows whose destination still belongs to
the accepted report. It sends one message per address, containing the report ID,
category, acceptance time and note. No staff recipient or park fallback is added.
Private photo access and account history remain separate capabilities.

The Node dispatcher uses the AWS SES SMTP baseline over TLS on port 465.
[Nodemailer SMTP configuration](https://nodemailer.com/smtp) documents its transport
and timeouts. Configure backend-only `SES_SMTP_HOST`, `SES_SMTP_USERNAME`,
`SES_SMTP_PASSWORD` and `REPORT_EMAIL_FROM` through ignored environment files.
Use SES SMTP credentials and a verified sending identity for that region.
SES sandbox restrictions still apply. Do not reuse S3 credentials.

After migration, `pnpm --dir backend reports:deliver --send` explicitly processes
up to twenty due notifications. Without `--send`, the command prints usage and
performs no dispatch. No scheduler or hosted deployment is configured by this PR.

Concurrent senders use PostgreSQL row locking. Explicit temporary SMTP rejection
returns the job to pending with exponential backoff, up to five attempts. Permanent
rejection becomes failed. A timeout, lost acknowledgement or expired sending lease
becomes uncertain and requires provider-side reconciliation before any resend.
SMTP acceptance is recorded as delivered to the provider, and does not establish
inbox delivery. Stable Message-ID helps trace attempts but does not guarantee
provider deduplication. Raw SMTP errors, recipients, report payloads and credentials
are excluded from logs.

Live SMTP verification requires approved sender credentials and a test recipient.
Automated checks use a stub adapter. No real message was sent during implementation.
