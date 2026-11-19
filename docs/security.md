# Security and privacy

Baseline: S1 pp. 9 and 12; S3 stories 1, 6, 7, and 10. This records project requirements; it does not certify an implemented system.

[J6-15](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-15) tracks location permissions, denial fallback, and exclusion of locations from server logs. Follow Figma's existing [location-share confirmation](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-277): preview the location and named recipients, state that nothing has been sent, and require the explicit confirm action. Prototype recipient names are not authorization to configure those destinations in production.

## Access boundaries

| Resource/action | Baseline access |
| --- | --- |
| Public GIS layers | Read-only public API with caching headers |
| Non-public GIS layers | Not included in public responses; exact authorized roles open |
| Submit an observation | Guests and signed-in users; no account required; validate all input |
| Staff report views, routing, status changes, exports | Authenticated, authorized Conservancy staff; park-routed reports only |
| Custom-recipient reports and attachments | No park-administrator access; delivery only to explicitly listed recipients |
| Report photos | Private S3 objects; time-limited presigned access after authorization |
| Share a visitor's location | Only on the visitor's explicit action |

The model has Visitor, Worker, and Administrator roles. S1 does not provide a complete role/action matrix; being a researcher or holding the Worker role must not implicitly grant every administrative privilege. Apply checks in the API, including individual records and media, rather than relying on hidden UI controls. Public visibility of ordinary park-routed reports remains unresolved (D-02); custom-recipient reports are private from park administrators by S8.

## Guest reporting and custom-recipient privacy

S8 confirms that guests may capture, submit, and queue reports without registering or signing in, including reports for themselves or their organization. Guest submission does not grant access to other reports. A missing user ID, predictable observation ID, or knowledge of a recipient email address must never serve as proof of ownership. D-01 will define secure guest history/access and recovery.

Custom-recipient mode is an access boundary, not just an email override. Exclude these reports from park staff lists/maps, search, aggregate summaries, individual detail endpoints, exports, image access, status/routing updates, and notifications. Enforce the same rule for Worker and Administrator roles. Do not publish them as GIS features or expose their content/recipient lists through staff logs. Allow only the submitter with valid ownership proof and the specified recipient delivery/access mechanism; an administrative role grants no access.

Persist the custom delivery mode and recipients with the report and its offline draft. Category defaults must not add staff recipients. Invalid/empty recipient lists or failed delivery retain private custom mode and require correction/retry; they must never trigger fallback delivery to the park.

## Location and images

- Request explicit device location permission before capturing GPS. The map remains interactive if permission is denied. Camera permission is needed for photo capture.
- The map GPS implementation requests foreground permission only after an explicit
  tap on **Follow my location**. Its first fresh fix starts following without a
  second tap; denial, failed acquisition, manual browsing or leaving the active
  Map session cancels that pending follow intent.
  It keeps fixes in memory, removes subscriptions on map blur/background/disable,
  and never adds device coordinates to GIS requests or logs. Returning to the map
  rechecks existing permission without automatically prompting again. Report and
  explicit location-sharing flows remain separate from this map-only permission.
- Do not write user GPS coordinates to server logs. Application request-error
  handling now returns fixed, uncached JSON errors without logging raw parser
  input, URLs, stack traces or dependency failures. Regression tests use synthetic
  coordinates and capture application stdout/stderr. This restores the backend
  privacy slice from closed PR #8 without replacing the newer mobile GPS flow.
  This is not a claim about reverse-proxy, Wrangler development request logs,
  production hosting/access logs or future analytics: review their independent
  logging policies before handling real visitor locations. See the
  [request-error contract](api.md#implemented-request-error-responses).
- Read needed EXIF GPS/time on submission, then strip unnecessary sensitive image metadata before storage. EXIF coordinates are optional evidence, not a replacement for report location.
- The approved initial capture policy requires 1–3 JPEG/PNG photos, 5 MiB each,
  16 MiB total request, at most 4,096 pixels per edge and 12 million decoded
  pixels. Missing GPS is allowed with an explicit reason; convert unsupported
  device formats on device where possible. The
  [local photo service](development/report-photos.md) enforces file/count/decode
  limits and strips metadata while physically preserving EXIF orientation. It
  authorizes staged reads/deletion with the guest's report-scoped secret and does
  not collect EXIF GPS/time. The development HTTP adapter enforces the complete
  multipart limit. The [AWS SDK S3 adapter](development/s3-report-photos.md)
  now implements private encrypted storage and owner-checked presigned access;
  [Custom-only local HTTP uploads](development/custom-reports.md) are implemented;
  mobile capture remains unimplemented. A live synthetic
  check verified bucket public-access blocks, guest isolation, anonymous denial,
  signed expiry and deletion. SMTP delivery uses separate server credentials.
- Do not make the S3 bucket public or persist expiring presigned URLs as durable image identifiers.
- Offline reports include photos and precise locations on the device. Their storage protection, retention, deletion, and sign-out behavior need an explicit policy (D-09).

## Transport, credentials, and untrusted input

All mobile/API exchange uses HTTPS/TLS. SES notifications use authenticated SMTP; encryption settings must be included in deployment configuration. Keep database, AWS, and SMTP credentials out of source control and mobile bundles; supply them through environment variables or managed secrets.

Validate and sanitize text, coordinates, category references, and uploaded files on the server. Proposed implementation safeguards: parameterized SQL, server-derived identity/status, content-based image validation rather than trusting extensions, and safe encoding when displaying report notes or generating email. Automated report moderation is out of scope, but these validation requirements are not moderation.

## Required verification

The current custom-only development release has explicit HTTP regressions for
private parser/validation/dependency errors and silent application output,
including console methods and stdout/stderr. Accepted custom records leave the
public GIS catalog and collections unchanged. Unimplemented report list, detail,
media, export, notification and mutation routes fail closed; untrusted client
role headers add no access. Reporting-disabled route misses are also no-store.
These tests do not exercise authenticated staff sessions: staff authentication
and report surfaces are not implemented. They must retain these boundaries when
introduced. See [acceptance evidence](development/custom-reports.md#acceptance-verification).

Check that unauthorized requests cannot view staff reports, alter statuses, export records, or obtain private media access; public layer requests cannot expose restricted features; invalid/oversized uploads are rejected; denied device permissions have usable fallbacks; location is absent from logs; and expired media links stop working. Authentication/session implementation, password policy, abuse limits, retention, and complete staff permissions are unresolved in D-01, D-02, D-04, and D-09.

Verify guest park/custom submissions and offline retries without a login prompt. Using a park-administrator session, verify a custom report is absent from lists, maps, summaries, exports, and notifications, and that direct detail/media/mutation requests are denied. Verify a different guest cannot retrieve the report by ID and that failed custom delivery never routes it to park staff.

## Public map presets

Visitor, Staff and Researcher are visibility presets over the public GIS catalog,
not authentication/authorization roles. They are never sent as permission claims
to the backend and do not expose private layers, reports, custom recipients or
media. Every public layer remains manually selectable in each preset. Existing
server access checks remain authoritative. See [preset behavior](development/layer-presets.md).

## Basemap providers (J6-68)

Enabled basemaps use public keyless provider endpoints directly. Tile requests
reveal the viewed area to that provider; GPS coordinates are not separately sent,
and neither viewport coordinates nor provider request URLs enter application logs.
The registry accepts no arbitrary visitor URL or credential. No administrative
credential or billing setting is added to Expo public configuration. Keyed
providers remain disabled until their dedicated Free account, read-only public
key, eligibility and provider-enforced zero-charge cap are evidenced under the
[activation gate](#zero-charge-rule-for-app-visible-keys).
The app cannot enforce a copied key's spend cap. Offline download authorization
continues to use the separate existing prototype configuration.

### Zero-charge rule for app-visible keys

This is an account-side guarantee, not a client request counter: a copied key
can be used outside the app. Before enabling any keyed source, record the date,
provider plan and evidence location without including real key values:

1. Use a dedicated Free-only account/project, separate from paid accounts,
   organizations, marketplace subscriptions and shared paid billing scopes.
   Do not attach payment details, credit/invoicing terms or a paid trial.
2. Verify provider-side hard rejection or suspension at the free limit for every
   service the key can access. Rule out automatic upgrades, additional usage,
   auto-recharge, top-ups and metered charges.
3. Use a public, read-only map key with the narrowest permissions. It must not
   manage accounts, billing, subscriptions, datasets or other keys. Keep account
   passwords, OAuth secrets and service/admin tokens out of the app. See
   [MapTiler credential types](https://docs.maptiler.com/guides/developer/credentials/).
4. Apply supported app/domain/API restrictions and per-key limits as additional
   abuse controls, checking native iOS/Android support. Web referrer restrictions
   alone may not work for a native renderer and do not establish a financial cap.
   Do not rotate identities or accounts to evade quotas.
5. Confirm the intended project qualifies beyond a development trial. Nonprofit
   status alone does not establish each vendor's Free-plan eligibility.
6. Test rejection using fixtures, a sandbox or a provider-supported low limit;
   do not deliberately exhaust the real free allowance.
7. Repeat the check before release and after account or terms changes. Disable
   the provider before a paid-plan transition and revoke old keys first, since
   already-installed apps retain them.

Missing evidence leaves the provider disabled. A billing alert or best-effort
app counter is insufficient. This gate does not authorize provider signup,
subscriptions or billing changes. No real keyed-provider account was inspected
or key used during the J6-68 implementation.

Only after the gate passes may a public map key enter the mobile bundle through
ignored local/build configuration. Do not commit values or put them in Jira,
screenshots, fixtures or logs. Expo public configuration is visible to the device,
not secret storage.
