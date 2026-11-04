# API and interfaces

Baseline transport: S1 pp. 9 and 12. Required workflows: S3 stories 1–3 and 6–10. S1 does not specify URL paths, payload field names, error envelopes, or authentication transport. The public GIS read contract below is implemented; reporting, tiles and additional filters remain **proposed**, to be finalized with D-01–D-07 before client/server implementation.

Use [J6-13](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-13) for trail/boundary/landmark GeoJSON endpoints and [J6-18](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-18) for cached read-only layer catalog/features. Reporting must support the existing [Figma recipient/review flow](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-260), including multiple explicitly listed recipients and recoverable validation failures; its payload and authorization rules still require D-03.

## Implemented operational endpoints

The local Worker foundation exposes `GET /health` for process liveness and
`GET /ready` for a Drizzle/PostGIS readiness query. Readiness returns `200` with
`{"status":"ok","database":"ok"}` or `503` with a generic
`DATABASE_UNAVAILABLE` error envelope. It uses `Cache-Control: no-store` and
never returns database error details. Public GIS endpoints are documented below; other domain endpoints remain proposed.

## Required interface behavior

| Boundary | Baseline contract |
| --- | --- |
| Mobile → GIS API | HTTPS GET; layer/trail data as GeoJSON or vector tiles; public read-only layers use caching headers |
| Mobile → reporting API | Guest or signed-in HTTPS POST using `multipart/form-data`, containing report text/metadata and JPEG/PNG file(s); no account required |
| GIS/reporting → data access | Drizzle operations and parameterized spatial SQL over the [source entities](data-model.md) |
| Reporting → S3 | Upload validated/sanitized images into private object storage; retain stable references |
| Reporting → email adapter → SES | Route using category/recipient configuration; authenticated SMTP notification |
| Staff UI → API | Authorized park-routed report filtering, status updates, and exports; exclude all custom-recipient reports |

## HTTP surface (public GIS reads implemented; other entries proposed)

| Method/path | Input and result | Access |
| --- | --- | --- |
| `GET /api/v1/layers` | Implemented public metadata catalog; pillar/type filters remain proposed | Public results limited to `is_public=true`; restricted access policy open |
| `GET /api/v1/layers/{layerId}/features` | Implemented: optional `bbox=west,south,east,north`; return a GeoJSON `FeatureCollection` | Same access check as parent layer |
| `GET /api/v1/layers/{layerId}/tiles/{z}/{x}/{y}` | Vector tile for a published tiled layer | Same access check as parent layer |
| `GET /api/v1/report-options` | Return approved categories and reporting choices | Guest-accessible; exclude private recipient details |
| `POST /api/v1/observations` | Multipart metadata plus `images`; return server observation ID and status | Guests or signed-in reporters; no client-assigned role/status |
| `GET /api/v1/observations` | Staff filters; proposed owner filter for personal report history | Staff see park-routed reports only; owner access requires valid account/guest ownership proof |
| `GET /api/v1/observations/{id}` | Authorized report detail and temporary media access | Park staff cannot access custom reports; owner/recipient access requires its own authorization |
| `PATCH /api/v1/observations/{id}` | Authorized status/recipient changes; return saved report | Authorized staff for park-routed reports only; cannot mutate custom reports |
| `GET /api/v1/observations/export` | Export authorized filtered records | Staff export excludes custom reports; format and researcher permissions open |

Static export routing must be distinguished from `/{id}` if these paths are adopted. History and safety data delivery remain open in D-05; they may use GIS feature properties or dedicated content interfaces. Authentication endpoints cannot be finalized until D-01 is resolved.

## Proposed report payload and processing

Use a JSON `metadata` multipart field containing `client_submission_id`, `category_id`, a GeoJSON Point `location`, capture time `captured_at`, `delivery_mode` (`park` or `custom`), and optional `note`, plus one or more `images` parts. Custom mode additionally requires a nonempty `custom_recipients` list. Field names are proposed; guest support and exclusion of custom reports from park administrators are confirmed by S8. These additions extend the source ER model and need migrations. Server receipt time and capture time must remain distinct when sending queued reports.

1. Accept guest or signed-in submissions. Validate category, coordinates, text, delivery mode, recipients, and image content/size. Derive account identity from the authenticated context when present; guests use a separate ownership mechanism, not a fabricated account or trusted client `user_id`.
2. For park mode, resolve category-based routing. For custom mode, validate and use only the reporter's listed recipients and persist the private access mode before any notification. Do not add category-default recipients or route failed/invalid custom submissions to staff. Recipient verification/delivery mechanics remain in D-03.
3. Save sanitized images and the observation/image records. Define recovery for partial S3/database failure; no success response may represent an incomplete accepted report.
4. Return the accepted report identity and status. Trigger a notification for the selected recipient. A stored report and a delivered email are different outcomes; email delivery failure must not silently lose the report.
5. Reconcile retried offline submissions without duplicate observations. Proposed implementation: scope a stable client submission ID to a verified account or guest submission context, enforce uniqueness, return the original result only to that context for identical retries, and reject conflicting reuse. Do not group all unauthenticated reporters into one owner or use an idempotency key alone to authorize report reads. Preserve custom mode/recipients across retries. D-07 must also define notification retries so report retries do not multiply emails.

## Proposed response rules

Use `201` for first creation, `200` for a recognized identical replay/read/update, and `304` for valid conditional GIS requests. Return a structured error such as `{"error":{"code":"INVALID_REPORT","message":"…","fields":{}}}`. Distinguish invalid input (`400`), unauthenticated (`401`), forbidden (`403`), missing resource (`404`), conflicting replay/state (`409`), oversized upload (`413`), unsupported media (`415`), and temporary server failure (`5xx`).

The client retains a queued report until server acceptance is confirmed. Retry temporary connection/server failures and preserve validation failures for correction. Account-based authorization may require renewed sign-in; guest capture/submission/sync must remain available without an account. Guest credential recovery must not expose reports or silently convert their ownership. Exact retry limits, pagination, payload bounds, cache validators, and export format are open. These examples are a proposed contract, not an existing API.

## Implemented public GIS reads (November 1, 2026)

- `GET /api/v1/layers` returns `{ "layers": [...] }` with public metadata only.
  Each entry has `layerId`, `name`, `description`, `layerType`, nullable `pillar`,
  `source`, `isDemo`, and origin-relative `featuresUrl`. Ordering is by layer ID.
- `GET /api/v1/layers/{layerId}/features` returns an RFC 7946 GeoJSON
  FeatureCollection with string feature IDs, object properties, SRID 4326
  longitude/latitude coordinates, and deterministic feature-ID ordering.
  Empty public layers return `200` with `features: []`.
- Optional `bbox=west,south,east,north` selects intersecting features via
  parameterized `ST_Intersects`; it returns full geometries, not clipped shapes.
  Four finite decimal values are required, longitude within [-180,180], latitude
  within [-90,90], west < east and south < north. Wrapped antimeridian boxes,
  repeated bbox parameters, missing values and zero-area boxes return `400`
  `INVALID_BBOX` with `fields.bbox`. Other filters/pagination are not implemented.
- Unknown and non-public layers return the identical structured `404 NOT_FOUND`.
  Visibility is checked in the same SQL statement as feature retrieval. Database
  failures return generic `503 DATABASE_UNAVAILABLE`; SQL and connection details
  are not returned or logged.
- Successful GIS reads use `Cache-Control: public, max-age=60`. Errors use
  `no-store`. A public response may remain in caches for up to 60 seconds after
  a visibility/data change; only publish data suitable for this policy. No
  application cache, custom validators, or Hyperdrive SQL caching is enabled.

[Mobile handoff](../backend/GIS-HANDOFF.md) contains exact requests/responses and
local addressing. [Contract types](../backend/src/modules/gis/types.ts) are
exported for client reuse without importing runtime database code. Native HTTPS
production transport remains required; local HTTP is development only.
