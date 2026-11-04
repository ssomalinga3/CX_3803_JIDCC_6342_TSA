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
only enables PostGIS; domain tables and endpoints remain subsequent work.

Local Workers connect directly to the database through a Hyperdrive local
connection override; this does not exercise deployed Hyperdrive pooling/caching.
The [proposed hosting plan](tasks/first-task-implementation-plan.md#8-proposed-hosting-and-hyperdrive-behavior)
retains managed PostgreSQL/PostGIS behind Hyperdrive. Production provider,
staging/production bindings, deployment ownership, and cache policy remain open
under D-10. S3/SES remain baseline; R2/Queues/HTTPS email are later proposals.

## Delivery expectations

S3 p. 4 requires documented local startup, reproducible database setup/migrations, backend Jest tests, mobile verification, lint/type checks, PR build checks, and an iOS build. See the backend guide for currently implemented commands; GIS/reporting functionality and native/device verification remain separate deliverables. Hosting, runtime versions, build/distribution details, and deployment ownership remain open in D-10.

Track implementation in the existing [J6 Jira backlog](https://gatech-team-f1s41wh9.atlassian.net/jira/software/projects/J6/boards/2/backlog); see the [ticket-to-specification map](README.md#jira-implementation-references). Use the existing [Figma prototype](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=0-1) for mobile screen design. Jira's spatial-table task differs from the PDF model and is recorded as D-12; neither source should be silently overwritten.

For how the pnpm workspace scripts are structured and how a new package joins them, see [workspace commands](workspace.md).
