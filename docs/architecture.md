# Architecture

Baseline: S1 pp. 6–9 and S5; feature scope: S3. Source links are in the [specification index](README.md#sources).

## Components and ownership

| Component | Technology | Responsibility |
| --- | --- | --- |
| Mobile application | React Native, Expo, TypeScript; native iOS components where appropriate | Shared map, navigation, education, report capture, permissions, local state |
| Primary map | MapLibre React Native | Native rendering of trails, boundaries, landmarks, and sustainability sublayers |
| 3D terrain view | WebView with MapLibre GL JS | Separate terrain visualization, limited to trails and terrain; stretch delivery |
| Offline GIS cache | Persistent device storage; implementation open | Retain base-map tiles and GIS data; refresh when connectivity returns |
| API client | REST over HTTPS | GIS requests and JSON/multipart report exchange; expose network/error states to UI |
| REST API | Node.js, TypeScript | Validate requests and invoke GIS/reporting modules |
| GIS module | Logical module within server | Read layers, trail geometry, and related spatial content |
| Reporting module | Logical module within server | Validate reports/images, persist observations, select recipients, request notifications |
| Data access | Drizzle ORM and spatial SQL | Schema/migrations, relational operations, and PostGIS queries |
| Database | PostgreSQL with PostGIS | Spatial features, reports, users/roles, and routing configuration |
| Image storage | Private Amazon S3 bucket | Report JPEG/PNG objects; database retains references |
| Email adapter | Authenticated SMTP to Amazon SES | Deliver report notifications to configured recipients |

The backend is one server application with separate responsibilities, not a microservice deployment. The mobile application accesses server data through the API. Database, S3, and SES credentials belong on the server. The [supplied component diagram](diagrams/architecture.puml) uses arrows from a dependent to its dependency.

## Main interactions

1. **Map:** UI requests layers through the API client. REST API → GIS module → data access → PostGIS. Results become GeoJSON or vector tiles, are cached where supported, and are rendered by the native map.
2. **Report:** A guest or signed-in reporter captures an image, consented location/time, category, and optional note. API client sends multipart data. Reporting validates the submission, persists its delivery/access mode with private images and report records, then requests email through the adapter. Custom mode sends only to explicitly listed recipients and excludes park administrators from record/media access and notifications (S8).
3. **Offline:** Cached maps remain available. S3 story 9 adds a durable report queue alongside the GIS cache; it is not explicitly shown in S5. On reconnect, queued reports use the same report API with duplicate-safe reconciliation.
4. **3D:** Enter a separate WebView rendering context when requested. S1 chooses this approach for terrain support and limits its layers because of performance and integration costs. This is a recorded project rationale, not a claim about every future MapLibre release.

## Implementation boundaries

Share TypeScript data contracts between client and server, while validating network input at runtime. Keep spatial SQL in data access, notification transport in the email adapter, and camera/location behavior in the mobile application. Do not put recipient credentials or database queries into the UI.

S3 story 7 includes a staff table/map view for report filtering and management, but does not select a separate web application or hosting stack. See [D-02](decisions.md) before choosing that surface. The historical/safety content storage contract also needs completion; do not introduce a CMS or sensor service as an assumed dependency.

## Local backend foundation (November 1, 2026)

The local development implementation uses Cloudflare Workers via Wrangler with
an Express adapter, Drizzle, and Docker PostgreSQL 16/PostGIS. The
[backend setup guide](../backend/README.md) documents reproducible setup,
migrations, generated Worker types, and local HTTP/database checks. `/health`
checks liveness; `/ready` exercises PostGIS through Drizzle. The initial migration
enables PostGIS; the subsequent GIS migration adds generic layers/features and public read endpoints (see the [handoff](../backend/GIS-HANDOFF.md)).

Local Workers connect directly to the database through a Hyperdrive local
connection override; this does not exercise deployed Hyperdrive pooling/caching.
The [proposed hosting plan](tasks/first-task-implementation-plan.md#8-proposed-hosting-and-hyperdrive-behavior)
retains managed PostgreSQL/PostGIS behind Hyperdrive. Production provider,
staging/production bindings, deployment ownership, and cache policy remain open
under D-10. S3/SES remain baseline; R2/Queues/HTTPS email are later proposals.

## Delivery expectations

S3 p. 4 requires documented local startup, reproducible database setup/migrations, backend Jest tests, mobile verification, lint/type checks, PR build checks, and an iOS build. See the backend guide for currently implemented commands; GIS/reporting functionality and native/device verification remain separate deliverables. Hosting, runtime versions, build/distribution details, and deployment ownership remain open in D-10.

Track implementation in the existing [J6 Jira backlog](https://gatech-team-f1s41wh9.atlassian.net/jira/software/projects/J6/boards/2/backlog); see the [ticket-to-specification map](README.md#jira-implementation-references). Use the existing [Figma prototype](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=0-1) for mobile screen design. D-12 records the project-owner decision to use generic GIS tables rather than the separate tables originally named by Jira.

For how the pnpm workspace scripts are structured and how a new package joins them, see [workspace commands](workspace.md).

## Mobile public GIS connection

The [supplied trail pipeline](../data/cascade-springs-gis/TRAILS.md) runs Python
conversion only in development/CI; runtime imports read the committed, validated
GeoJSON. Both the combined source command and trail-only command select supplied
trails using the same advisory lock. Explicit per-layer collections replace
geometry-type-only selection, with duplicate assignment checks and transactional
rollback. Neither GIS tooling nor source archives enter the mobile bundle.

The mobile client reuses the backend GIS contracts through type-only imports;
no database or Worker runtime modules enter the mobile bundle. It validates
catalog metadata, same-origin feature paths, and GeoJSON at runtime before
passing a complete snapshot to native MapLibre. Requests are abortable and have
a bounded loading time; failed/empty API reads remain distinct from basemap
failure. The first integration reads full public collections in memory only.
See the [integration guide](development/integration-branch.md) for the combined
branch workflow, transport configuration, rendering verification, and deferred
large-dataset/offline work.

Public feature details use the same in-memory, runtime-validated snapshot. The
mobile loader retains an exact feature-ID-to-layer map so a native hit-test can
resolve public metadata without another request or parsing layer IDs out of a
combined string. Ambiguous combined IDs reject the snapshot. Display fields are
allowlisted, and raw source HTML is converted to native text without remote
media execution. Selection never includes the device-position source and is
invalidated on snapshot replacement or Map blur. See
[J6-20 details](development/feature-details.md); no server or schema change is
required.

### Layer visibility (J6-19)

One root `MapGisProvider` owns the public snapshot and session-only hidden layer
IDs. Map and `/layers` share that state; opening the chooser or applying switches
does not reload GIS or request location. An outer Expo Router stack contains the
existing tab group and the selection screen, preserving the mounted map and its
camera while the chooser is open. The existing tab URLs remain unchanged.

Preset and switch changes apply immediately to shared state; Done only closes
the chooser, and leaving by any route retains the choices. Rendering,
feature hit-testing, counts and the trail legend use the same filtered snapshot
with original feature IDs and provenance. Camera fitting retains the original
catalog bounds and is suppressed for visibility-driven layout changes. Trail strokes
render above ground/context/analytical overlays; landmark markers and labels render
above routes, and device position remains a separate source above GIS.
Visitor is the initial public viewing preset. Staff and Researcher add context
and observations; current catalog IDs follow preset defaults plus explicit
per-layer overrides. Applied choices survive in-session retry, while fresh
provider sessions start in Visitor. Nothing is persisted across application restarts.
See [layer selection verification](development/layer-selection.md).

### Supplied PDF context (PR 3)

The [PDF pipeline](../data/cascade-springs-gis/PDF-MAP.md) uses the locked GIS
development environment to extract georeferenced context and reconcile landmarks.
Runtime imports read committed GeoJSON; PDFs, image extraction and GIS libraries
do not enter mobile bundles. Source/PDF/legacy-boundary/trail commands share lock
`(6342, 2)`; source import replaces all selected layers in one transaction.
The native renderer distinguishes context kinds, excludes context lines from the
trail legend, keeps trail strokes above context and signal samples, and adds closer
zoom landmark labels. Existing chooser, snapshot, camera, GPS and offline
architecture remain unchanged.

### Bounded two-source terrain (PR 4)

The [terrain pipeline](../data/cascade-springs-gis/TERRAIN.md) runs only during
development/CI. It preserves a bounded USGS national GeoTIFF alongside the
supplied source archive, then generates two source layers with generalized
elevation polygons and versioned bundled hillshade images. Mobile groups these
alternatives under one Elevation switch and source dropdown, defaults to USGS
and renders only the selected source. Source preference and enabled state remain
session-only, separate from other hidden-layer IDs. The API remains GeoJSON-only;
image footprints coordinate catalog visibility with local assets. Native
ImageSource uses an explicit local asset
allowlist. A mismatched dataset version/hash/placement rejects the snapshot and
uses the existing error/retry path. No raster URL serving or Worker asset
binding is introduced. Import commands read committed files outside the request
runtime; source rasters/GIS libraries are absent from app/Worker bundles.

The combined source importer now replaces all nine selected layers atomically;
terrain-only replacement shares lock `(6342, 2)` with existing source writers.
No physical tables, native dependencies, GPS behavior or durable offline cache
are added. Hosting configuration and deployment ownership are outside this slice.

## Approximate signal observations (PR 5)

The [signal pipeline](../data/cascade-springs-gis/SIGNAL.md) registers and extracts
the preserved screenshot offline, publishing 677 categorical Point samples in one
additional layer. The combined importer replaces ten layers / 808 features under
lock `(6342, 2)`; a signal-only writer preserves other layers. Runtime imports read
committed GeoJSON. Mobile validates the small class/source contract, renders dark
outlined class dots below trails/landmarks, and reuses the chooser/snapshot lifecycle.
Exact readings, units and survey context remain absent. No device connectivity
collection, interpolation service, native dependency or durable offline cache is added.

### Natural map order

The [rendering policy](development/map-layer-order.md) centralizes native layer
placement. Permanent invisible terrain slots and an always-mounted empty-capable
public source keep raster/vector/GPS placement stable during visibility changes,
API failure and style reload. Source catalog order does not determine z order.

### Audience visibility presets

[Visitor, Staff and Researcher presets](development/layer-presets.md) are local
display choices over the same public snapshot, not authorization roles. The
provider reconciles preset defaults with explicit visibility overrides; the
chooser applies presets and switches immediately. Defaults prefer one known terrain
source. Source identity, backend access, GPS, z order and offline scope remain
unchanged. Preset changes do not reload GIS or refit the camera.
