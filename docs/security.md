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
- The map GPS implementation requests foreground permission on **Use my location**.
  It keeps fixes in memory, removes subscriptions on map blur/background/disable,
  and never adds device coordinates to GIS requests or logs. Returning to the map
  rechecks existing permission without automatically prompting again. Report and
  explicit location-sharing flows remain separate from this map-only permission.
- Do not write user GPS coordinates to server logs. Proposed implementation checks include request-body redaction and excluding sensitive values from error/analytics payloads.
- Read needed EXIF GPS/time on submission, then strip unnecessary sensitive image metadata before storage. EXIF coordinates are optional evidence, not a replacement for report location.
- Restrict uploads to JPEG/PNG and enforce a configured maximum size. Exact image count, byte/dimension limits, and handling of unsupported phone formats are open in D-04.
- Do not make the S3 bucket public or persist expiring presigned URLs as durable image identifiers.
- Offline reports include photos and precise locations on the device. Their storage protection, retention, deletion, and sign-out behavior need an explicit policy (D-09).

## Transport, credentials, and untrusted input

All mobile/API exchange uses HTTPS/TLS. SES notifications use authenticated SMTP; encryption settings must be included in deployment configuration. Keep database, AWS, and SMTP credentials out of source control and mobile bundles; supply them through environment variables or managed secrets.

Validate and sanitize text, coordinates, category references, and uploaded files on the server. Proposed implementation safeguards: parameterized SQL, server-derived identity/status, content-based image validation rather than trusting extensions, and safe encoding when displaying report notes or generating email. Automated report moderation is out of scope, but these validation requirements are not moderation.

## Required verification

Check that unauthorized requests cannot view staff reports, alter statuses, export records, or obtain private media access; public layer requests cannot expose restricted features; invalid/oversized uploads are rejected; denied device permissions have usable fallbacks; location is absent from logs; and expired media links stop working. Authentication/session implementation, password policy, abuse limits, retention, and complete staff permissions are unresolved in D-01, D-02, D-04, and D-09.

Verify guest park/custom submissions and offline retries without a login prompt. Using a park-administrator session, verify a custom report is absent from lists, maps, summaries, exports, and notifications, and that direct detail/media/mutation requests are denied. Verify a different guest cannot retrieve the report by ID and that failed custom delivery never routes it to park staff.
