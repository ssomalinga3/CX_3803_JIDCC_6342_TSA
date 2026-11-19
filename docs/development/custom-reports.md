# Custom-recipient report submission (J6-30)

The owner selected custom recipients first on November 18, 2026 and confirmed
the **custom-only development release** as the current acceptance scope. This backend
slice uses explicitly labeled development categories and private S3 photos.
Park routing, durable device retries (J6-33), and the SMTP sender (J6-32) remain
separate work. The [J6-31 mobile form](mobile-reporting.md) now uses this API.
A receipt confirms storage and queued
notification work, not email delivery.
Production categories, routing and deployment configuration do not block this
development scope; this is not authorization to enable hosted writes.

## Start and verify locally

Use the pinned Node/pnpm versions from the workspace root. Start local PostGIS
first. These examples use this machine's port 55434; use your configured Docker
port elsewhere. Keep AWS configuration in ignored `backend/.env`; see
[S3 configuration](s3-report-photos.md). Never put credentials in Expo or argv.

```sh
source "$HOME/.nvm/nvm.sh"
nvm use
CASCADE_DB_PORT=55434 pnpm --dir backend db:migrate
CASCADE_DB_PORT=55434 pnpm --dir backend reports:dev
```

The wrapper starts a loopback Worker on port 8787 (`REPORTING_PORT` overrides),
rejects non-loopback database hosts, puts only S3 bindings into a mode-0600
temporary `.dev.vars`, suppresses Wrangler output, and removes temporary files
on normal exit. Startup requires `/ready`. Stop it before starting another
backend on the same port. Production configuration leaves reporting disabled;
the hosted runtime database login remains read-only.

In another terminal:

```sh
CASCADE_DB_PORT=55434 pnpm --dir backend reports:check
CASCADE_DB_PORT=55434 pnpm --dir backend test:integration
```

`reports:check` submits a synthetic photo through the actual Worker to private
S3, checks first acceptance, identical replay and one pending notification, then
deletes its test objects and database records. No SMTP is sent. It uses an
example.test address and prints no credentials, object keys or signed URLs.
Cleanup failure returns nonzero and retains the database intent for investigation.

## HTTP contract

- `GET /api/v1/report-options`: no-store development marker, custom mode only
  and four `dev-*` categories labeled Human/Social/Environmental/Economic.
  These fixtures do not approve production category mappings.
- `POST /api/v1/observations`: `Authorization: Bearer <64 lowercase hex>` using
  a random report-scoped 256-bit secret, one JSON `metadata` field and 1–3
  ordered `images` parts. See [request/receipt examples](../reporting-contract.md),
  using `dev-environmental` for the local category.
- Bound the complete body to 16 MiB, metadata to 64 KiB and each photo to 5 MiB.
  Header validation enforces 4,096 pixels per edge and 12 million pixels;
  filenames and MIME claims do not determine image type.
- Accept custom mode only, with 1–20 mailbox addresses. Trim whitespace,
  lowercase domains, preserve local-part case, deduplicate and sort. Reject
  display names, quoted locals, non-ASCII addresses and header injection.
  Notes are at most 2,000 characters. These are development operational bounds;
  final production recipient policy remains open.
- Require UTC capture time and either a valid Point or explicit missing-GPS
  reason. Reject unsupported fields and owner/status claims. Validation errors
  describe corrections without echoing submitted values.
- Return 201 on first acceptance and 200 with the same receipt on authorized
  identical replay, including after category removal. Changed payload gets 409;
  another guest gets generic 404. A live attempt gets
  `409 SUBMISSION_IN_PROGRESS` plus `Retry-After`. Receipts/errors are no-store.
  Resolve uncertain outcomes with the original request. Corrections after a
  definitive rejection use a new UUID.

## Persistence and failure handling

Migration `0003_custom-report-submission.sql` adds owner/payload reservations,
upload-attempt journals and the notification outbox. Short per-submission
transaction locks serialize database operations without holding transactions
during S3 requests. The development lease is 120 seconds. Expired attempts can
be reclaimed by the same owner and cannot later accept or journal new keys.

Journal each random key before writing it. Replay identity hashes normalized
metadata and ordered original image bytes. Sanitize the entire batch before
writing any photo. Acceptance atomically writes the observation, image
references, custom destinations, receipt and one pending outbox row per address.
Outbox uniqueness prevents duplicate logical notifications.

Reconcile uncertain commits before cleanup. Keep accepted references and invalidate
failed attempts before deletion. Failed reconciliation/cleanup retains durable
object intents. **A scheduled abandoned-upload reconciler is not implemented**;
crash/cleanup leftovers require later reconciliation. No SMTP sender consumes the
outbox. J6-32 must deliver separately per recipient, authorize media delivery and
reconcile ambiguous SMTP outcomes, preserving custom mode without park fallback.

## Evidence and remaining limits

November 18 live check passed with the local Cloudflare Worker, private S3 and
local PostGIS: acceptance, identical replay, one pending notification and test
cleanup. Regression cases cover concurrency, guest/payload conflicts, retired
categories, failed uploads, lost commit responses, outbox rollback, retained
cleanup intents, expired leases, malformed/oversized requests and default-off
routes. No staff report/media endpoints are introduced; public GIS stays separate.

iOS/Android reporting UI, device permissions, offline restart, production writes,
SMTP, production categories, abuse controls, hosting logs, retention, scheduled
cleanup and notification retries remain unverified or unimplemented.

## Acceptance verification

| J6-30 criterion                     | Evidence for the custom-only development scope                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime-validated guest submission  | Real-PostGIS HTTP tests accept guest multipart with no account; reject invalid category, delivery mode, recipient, time, location, owner/status claims and image input; preserve ordered photos and consented longitude/latitude. Development options explicitly expose custom mode only.                                                                                                                                                               |
| Durable, duplicate-safe receipt     | Tests cover 201 acceptance/200 identical replay, concurrent in-flight retries, changed owner/payload denial, expired leases, lost commit response and rollback when outbox insertion fails. Receipts appear only after durable acceptance.                                                                                                                                                                                                              |
| Custom isolation and private output | Before/after public catalog and every public feature collection stay equal. Report list/detail/media/export/notification/mutation probes remain unavailable with anonymous requests, unrelated credentials, untrusted staff-role headers or even the submitting guest secret. Only the chosen normalized addresses appear in pending outbox work. No public route reads the photo store.                                                                |
| Real-database HTTP failures         | Submission tests capture console log/info/warn/error/debug/trace and stdout/stderr across validation/parser failures, storage errors, repository failures, real database constraint failure, accepted/replayed receipts and owner/payload conflicts. Captured application output is empty. Errors/receipts are no-store and contain fixed envelopes without request values, filenames, coordinates, recipients, URLs, secrets or raw dependency errors. |

The default-disabled route regression exposed missing cache headers on generic
404 responses. The fallback now applies `Cache-Control: no-store` regardless of
reporting configuration. Public GIS success responses retain their public cache
policy.

Focused reproduction:

```sh
CASCADE_DB_PORT=55434 pnpm --dir backend test:integration --runTestsByPath test/report-submissions.test.ts test/privacy.test.ts test/observations.test.ts
```

November 18 final verification: `CASCADE_DB_PORT=55434 pnpm --dir backend test:fresh`
passed all **245 tests across 18 suites**, migration replay, source-import replay,
Worker HTTP/readiness/database-failure checks and Worker photo/SDK checks. The
disposable database was removed. Backend lint, typecheck, TypeScript build,
production Worker dry-run (no deployment, dotenv loading disabled), root format
check and `git diff --check` passed. The saved AWS values were checked privately
against changed sources and were absent; `backend/.env` remained ignored and
mode 0600. This completes the automated acceptance verification for the agreed
development scope; commit, PR review/merge and Jira completion remain separate.

The output assertions cover application handlers and libraries invoked by them,
not operating-system, reverse-proxy, hosting access logs or analytics. The local
reporting wrapper separately drains Wrangler output. There are no authenticated
staff sessions or staff report endpoints yet: role headers in these tests are
hostile client claims, not proof of a completed staff authorization matrix.
Future staff/media endpoints must add genuine authenticated-session isolation
tests rather than relying on today's unavailable routes. Device/iOS reporting
and SMTP acceptance remain in their separate tickets.
