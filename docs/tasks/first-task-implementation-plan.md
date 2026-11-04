> **Current implementation update — November 1, 2026:** Public GIS schema,
> repeatable synthetic seed, catalog/features and optional bbox filtering are
> implemented on the local Worker foundation. D-12 is resolved in favor of generic
> tables by project-owner instruction. See the [handoff](../../backend/GIS-HANDOFF.md)
> for the current contract and verification commands. The original planning text
> below is retained as historical context; its open D-12 question and generic-model
> assumption are superseded. Production hosting/staging, approved GIS data, pillar
> assignments, native rendering and device/offline acceptance remain deferred.

# Agent's Proposed Implementation Plan — First Task

Task: [first-task-gis-layers.md](./first-task-gis-layers.md)
Status: **GIS task remains proposed. Local backend foundation implemented in
this change** at the project owner's request. Workers startup, Docker PostGIS,
Drizzle extension migration, and operational readiness are implemented; GIS
schema/endpoints and production deployment remain subsequent work. See the
[backend setup guide](../../backend/README.md) for current commands. The original
Development Readiness plan below is retained with that narrower implementation
status; future steps still require their applicable decisions.

Updated November 1, 2026: proposed Cloudflare Workers hosting with Hyperdrive
and managed PostgreSQL/PostGIS, including local development and staging
verification. This records the requested plan update; it does not mark D-10
hosting as approved or implemented.

## 1. Repository investigation (what the agent found)

- The repo is a pnpm workspace (`pnpm-workspace.yaml`) with members `mobile`,
  `backend`, and `packages/*`. `backend/` is now scaffolded: Express 5 + strict
  TypeScript (ESM), `src/app.ts` (app, no port) / `src/server.ts` (listener) /
  `src/config.ts` (env), a `/health` route, a structured 404 error envelope, and
  Jest + ts-jest + supertest with passing tests.
- Root scripts aggregate per-package checks recursively (`pnpm -r lint |
typecheck | test | test:ci`), matching [docs/workspace.md](../workspace.md).
  CI (`.github/workflows/ci.yml`) runs these on PRs and pushes to `main`.
- Authoritative specs reviewed: [architecture.md](../architecture.md) (GIS
  module → data access → PostGIS; Drizzle; boundaries), [api.md](../api.md)
  (proposed `/api/v1/layers` and `/features`, GeoJSON, structured errors),
  [data-model.md](../data-model.md) (`gis_layer`/`gis_feature`, SRID 4326,
  spatial indexes), [security.md](../security.md) (public read-only layers,
  no GPS in logs), and [decisions.md](../decisions.md) (D-05, D-12 constrain
  the GIS schema and data; stack is resolved).
- No database, ORM, or domain route exists yet. There is a clean seam to add
  routers and a data-access module onto `createApp()`.

## 2. Constraints the agent will honor

- Use pnpm + the single root lockfile; add backend deps via the backend package;
  no npm/Yarn lockfiles ([AGENTS.md](../../AGENTS.md)).
- Keep spatial SQL in data access; routes stay thin. Validate `bbox` at runtime.
- Ship **public layers only**; do not implement restricted-layer auth (D-02).
- Build on the S1 `gis_layer`/`gis_feature` model; do **not** adopt Jira's
  per-type tables until **D-12** is resolved. Record this assumption in the
  migration and README.
- Seed data is clearly placeholder; no real/authoritative GIS data (D-05).
- No credentials in source. Node migration/seed tools use `DATABASE_URL`;
  Worker data access receives the Hyperdrive binding connection string.
- Retain PostgreSQL/PostGIS and Drizzle. D1 would require a separate GIS
  redesign and is not the database proposed here.
- Keep the Node 24/pnpm tooling pins; Workers is a separate runtime with its
  own pinned compatibility date and required compatibility flags.

## 3. Proposed steps

1. **Dependencies** — add to `backend`: `drizzle-orm`, `pg`; dev: `drizzle-kit`,
   `@types/pg`, `wrangler`, and Worker environment type generation. Select
   compatible versions and retain the root lockfile. Add Workers runtime
   testing dependencies only if needed alongside the required Jest suite.
2. **Local database** — add `backend/docker-compose.yml` using the `postgis/postgis:16-*`
   image, exposing 5432, with a named volume. Document `docker compose up -d`.
   Add `DATABASE_URL` to `.env.example` (already placeholdered).
3. **Drizzle config + schema** — `drizzle.config.ts` and
   `src/db/schema.ts` defining `gis_layer` and `gis_feature` with a PostGIS
   `geometry(Geometry, 4326)` column and jsonb `properties`. Add a GiST index on
   `gis_feature.geometry` (via a custom SQL statement in the generated migration
   if drizzle-kit cannot express GiST directly).
4. **Migration scripts** — `db:generate`, `db:migrate`, `db:reset`, `db:seed` in
   `backend/package.json`. Generate the first migration. Add a seed script
   inserting a couple of public layers and a few sample features.
5. **Data access** — `src/db/client.ts` (request-scoped Worker connections
   through the Hyperdrive binding; injected connection configuration for tests)
   and `src/modules/gis/layers.repo.ts` with `listPublicLayers()` and
   `getPublicLayerFeatures(layerId, bbox?)`. Spatial filtering uses a
   parameterized `ST_Intersects(geometry, ST_MakeEnvelope(...,4326))`.
6. **Validation + types** — `src/modules/gis/types.ts` for shared layer/feature
   response shapes; a small `parseBbox()` that returns `400` on malformed input.
7. **Routes** — `src/modules/gis/layers.router.ts` mounting
   `GET /api/v1/layers` and `GET /api/v1/layers/:layerId/features`; convert rows
   to GeoJSON `FeatureCollection` with `[lng, lat]`; wire into `createApp()`
   before the 404 fallback. Add `src/worker.ts` using Cloudflare's
   `httpServerHandler` Express adapter, keeping Node process shutdown handling
   in `server.ts`. Add `wrangler.jsonc` with a pinned compatibility date,
   Node compatibility, generated binding types, and separate staging/production
   bindings. Do not assume Node lifecycle APIs have identical Worker behavior.
8. **Tests** — supertest integration tests against a test database (CI service
   container or a disposable schema): list returns public-only; features return a
   valid FeatureCollection; bbox filters; invalid bbox → 400; non-public → 404;
   unknown id → 404. Verify actual spatial behavior against PostGIS, including
   a geometry whose bounding box overlaps the viewport but whose geometry does
   not intersect it. Repeat the HTTP acceptance paths through Wrangler to
   exercise the Worker entry point and binding-based database client.
9. **CI** — add a PostGIS service container to the CI job and the
   `db:migrate`/`db:seed` steps before `test:ci` so integration tests run in CI.
   Add a Wrangler bundle check and local Worker HTTP checks against the CI
   database. Keep authenticated staging deployment/smoke checks separate from
   ordinary PR tests; do not expose deployment secrets to untrusted PRs.
10. **Docs** — update `backend/README.md` with database setup, migration, seed,
    and verify commands, local Worker startup, environment configuration, and
    staging checks; note the D-12 assumption and public-only scope. Record any
    approved hosting change in architecture.md and D-10 before implementation.

## 4. Interfaces affected

- New: GIS schema, migration, data-access module, GIS router, shared GeoJSON
  response types, Worker entry point, Wrangler configuration, generated binding
  types, and local/staging runtime checks.
- Changed: `createApp()` (mount router), `backend/package.json` (deps + db
  scripts), `.env.example`, local secret-file ignore rules as needed, CI workflow,
  `backend/README.md`. HTTP response contracts remain the same across runtimes.
- Unchanged contracts: the proposed report payload and auth surfaces in api.md
  are untouched (deferred).

## 5. Verification plan

- `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test:ci`, `pnpm backend:build`.
- Manual: `docker compose up`, migrate, seed, `curl /api/v1/layers` and
  `/features?bbox=...`.
- Security checks: non-public layer absent from both endpoints; no GPS/location
  or credentials in logs; `git diff --check` and final diff review.

## 6. Open questions for the team to resolve before implementation

1. **D-12**: Confirm building on `gis_layer`/`gis_feature` now, reconciling to
   any per-type tables later via migration. If the team wants the Jira
   per-type-table design first, the schema step changes materially.
2. **D-05**: Is placeholder seed data acceptable for this task, with real GIS
   ingestion tracked separately? What pillar values should the seed use?
3. **bbox semantics**: `ST_Intersects` vs fully-contained; and whether to cap
   result counts / add pagination now (api.md leaves bounds open).
4. **CI database**: provision real PostGIS for spatial integration tests;
   confirm the CI service image and runtime-test setup.
5. **Caching headers**: api.md says public layers "use caching headers" but
   leaves validators open — include basic `Cache-Control` now or defer?

6. **D-10 hosting**: confirm Workers + Hyperdrive, a managed database provider
   with PostGIS, region, shared account ownership, budget, staging resources,
   backup/recovery, and deployment responsibilities.

## 7. Team review notes

> Fill in during the Go/No-Go Review: does this plan match our requirements and
> design? What would we change? Who owns which step? Record decisions in
> [decisions.md](../decisions.md) and update this file before implementation.

## 8. Proposed hosting and Hyperdrive behavior

```text
Mobile app → Workers REST API → Hyperdrive → managed PostgreSQL/PostGIS
```

Hyperdrive handles connection setup and pooling; PostgreSQL continues to run
spatial queries and maintain GiST indexes. It does not host or replicate the
origin database. Uncached reads and writes still travel to that database, so
choose a suitable region and avoid unnecessary sequential database round trips.
Measure deployed latency with representative GIS data before setting budgets.

Hyperdrive uses transaction pooling. Keep transaction-dependent settings inside
the transaction; do not rely on session state surviving across transactions.
Use Cloudflare's supported Drizzle/pg connection lifecycle rather than retaining
live database clients across Worker requests. Run migrations as separate Node
commands against the intended database, not inside request handlers.

Query caching is enabled by default. Initially configure Hyperdrive caching off
for correctness, especially future reports, ownership, and authorization reads.
Consider a separate cache-enabled configuration for public GIS reads only after
agreeing on freshness/invalidation. HTTP GIS caching and Hyperdrive SQL caching
are distinct policies; neither substitutes for authorization.

For later reporting work, consider private R2 objects instead of S3, Queues for
notification retries, and an HTTPS email adapter (potentially SES). These are
proposals outside the first task, not replacements of the current baseline.
Resolve image validation/metadata stripping within Workers limits, object/database
partial failures, and durable notification dispatch before implementing reports.
Queues delivers at least once; use duplicate-safe processing and an outbox or
reconciliation mechanism so a database commit followed by enqueue failure cannot
lose a notification. Preserve guest ownership and custom-recipient privacy across
storage, delivery, failures, and retries. D-01/D-03/D-04/D-07 remain open.

## 9. Local development workflow (after implementation)

Workers startup, Docker PostGIS, and migration commands are implemented;
GIS seed/endpoint commands remain future work. Use the
[backend setup guide](../../backend/README.md) for the default workflow. Install dependencies from the workspace root
using pnpm and keep one root lockfile.

1. Start PostgreSQL/PostGIS with the planned Compose file:
   `docker compose -f backend/docker-compose.yml up -d`.
2. Apply migrations and seed placeholder data using the planned
   `pnpm --dir backend db:migrate` and `pnpm --dir backend db:seed` scripts.
   Migration tools use `DATABASE_URL` from documented local configuration.
3. The implemented `pnpm backend:dev` launcher sets the local override automatically.
   For a manual override, configure the local connection and start Wrangler from the root:

   ```bash
   export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE='postgres://cascade:cascade_local_only@127.0.0.1:55432/cascade_springs'
   pnpm --dir backend exec wrangler dev
   ```

   The URL is illustrative local-only configuration; match the Compose database
   credentials/name. The suffix `HYPERDRIVE` must match the Wrangler binding name.
   Keep real credentials in ignored local configuration or shell environment;
   never commit them. Wrangler's local connection-string environment variable
   overrides its `localConnectionString` configuration field.

4. Request `/health`, `/api/v1/layers`, and the feature/bbox endpoints using the
   address printed by Wrangler (normally `http://localhost:8787`). Changes reload
   locally; no deployment is needed for each edit.
5. For a physical Expo device, run Wrangler with `--ip 0.0.0.0` on a trusted
   development network and configure the mobile API URL with the laptop's LAN
   address. Device `localhost` refers to the device. Verify simulator/emulator
   addressing separately; keep any development transport exceptions out of
   production configuration.

Local Wrangler runs the Worker runtime and connects directly to the configured
PostGIS database. **Actual Hyperdrive pooling and query caching are bypassed.**
This verifies runtime compatibility and SQL behavior, not deployed Hyperdrive
performance. Later R2/Queues work should use supported local bindings and a fake
email adapter for routine tests, with separate staging integration checks.

## 10. Test layers and staging verification

| Layer                                | Required evidence                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Jest + supertest                     | Existing health/config checks and meaningful validation/access tests; real PostGIS integration for spatial behavior                         |
| Local Worker + test PostGIS          | HTTP acceptance paths through the Worker adapter, binding configuration, spatial filtering, restricted-layer exclusion, and error envelopes |
| Wrangler build                       | Bundle resolves for Workers using the pinned compatibility settings; separate from Node TypeScript compilation                              |
| Cloudflare staging + staging PostGIS | Actual Hyperdrive connectivity, pooling, cache policy, secrets, TLS, database failure handling, and representative latency                  |
| Mobile integration                   | Map layer requests from target devices; backend checks do not establish native compilation or device acceptance                             |

Keep Jest as required by the project. Add Cloudflare's Vitest Workers integration
if direct in-runtime tests are useful; do not replace the Jest requirement
silently. A local HTTP test against Wrangler can also exercise the deployed entry
point without moving the application test suite.

After configuring an explicit staging environment and its own Hyperdrive/database,
use this optional remote development command from the root:

```bash
pnpm --dir backend exec wrangler dev --remote --env staging
```

This executes on Cloudflare with real pooling/caching and real remote side
effects; it ignores the local connection string. Point every staging binding,
secret, database, and later media/queue/email destination at staging resources.
Also smoke-test an actual staging deployment before release. Use the same
migrations and fixtures as local integration tests, and record deployed results
separately from local checks. Validate cache freshness explicitly if enabled.

For later reporting, extend both local and staging tests to guest park/custom
submissions, lost-response retries, one accepted observation, notification
deduplication, partial storage failures, and denial of all staff access to custom
reports. Verify offline restart/retry and permission denial on mobile per
[user flows](../design/user-flows.md).

## 11. Cloudflare implementation references

Reviewed November 1, 2026; recheck compatibility requirements during implementation.

- [Workers local development](https://developers.cloudflare.com/workers/local-development/)
- [Express adapter and Node compatibility](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/)
- [Hyperdrive local and remote development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/)
- [Hyperdrive Drizzle integration](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/)
- [Hyperdrive transaction pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/)
- [Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)
- [Workers testing](https://developers.cloudflare.com/workers/testing/)
- [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
