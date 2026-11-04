# Backend: local Workers + PostGIS

The API runs locally in Cloudflare Workers through Wrangler, using Express 5,
TypeScript, Drizzle, and PostgreSQL 16/PostGIS. No Cloudflare account, cloud
resources, or real credentials are needed for local development.

## First run from a fresh clone

Install [nvm](https://github.com/nvm-sh/nvm) and Docker Desktop (Mac) or Docker
Engine with Compose v2 (Linux). Start Docker before setup. On Windows, use WSL2
with Docker integration and run these commands inside WSL2.

From the **workspace root**:

```bash
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm backend:setup
pnpm backend:dev
```

`nvm install` installs the version in [`.nvmrc`](../.nvmrc); on later sessions,
`nvm use` selects it. Corepack uses the pnpm version pinned in root
[`package.json`](../package.json). Install dependencies at the workspace root;
keep the single root lockfile.

`backend:setup` generates Worker types, starts a healthy PostGIS container,
applies committed Drizzle migrations, and checks a PostGIS query through Drizzle.
It is safe to rerun and preserves existing database contents. `backend:dev`
starts Wrangler with automatic reload, normally at `http://localhost:8787`.

In another terminal:

```bash
curl http://localhost:8787/health
curl http://localhost:8787/ready
```

`/health` checks process liveness. `/ready` returns
`{"status":"ok","database":"ok"}` only after a successful Drizzle/PostGIS query.
It returns a generic `503` if the database is unavailable and never includes
connection strings, SQL errors, or coordinates. Readiness responses are not cached.

## Everyday workflow

```bash
nvm use
pnpm backend:setup    # start database, apply new migrations, regenerate types
pnpm backend:dev      # Ctrl+C stops the Worker; database remains available
```

The database persists in the Compose volume `cascade-springs-backend_postgres_data`.
Stop it without deleting data using:

```bash
pnpm --dir backend db:down
```

The upstream `postgis/postgis:16-3.5` image is amd64. Compose explicitly selects
that platform, so Apple Silicon uses Docker Desktop's amd64 emulation. First
startup pulls the image and can take longer. Linux ARM needs compatible amd64
emulation. The database binds only to loopback, on port **55432** to reduce
conflicts with an existing PostgreSQL installation.

## Configuration and port conflicts

The default local URL is:

```text
postgres://cascade:cascade_local_only@127.0.0.1:55432/cascade_springs
```

These are disposable development credentials for the loopback-only Compose
service, not production secrets. Defaults are confined to Node tooling in
[`scripts/local-config.mjs`](scripts/local-config.mjs), not the Worker bundle.

No `.env` is required. For overrides, copy [`.env.example`](.env.example) to
`backend/.env`. Node tooling and Compose read it. For example, set
`CASCADE_DB_PORT=55433` to change both the published database port and the default
connection URL, then rerun setup. This preserves the volume. `DATABASE_URL`
overrides the complete URL for migration/check/Studio commands and the default
local Worker connection. Keep overrides pointed at a development database.
Shell environment values take precedence over `.env`.

The dev launcher supplies
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` automatically.
An explicitly set value overrides the Worker's local connection only; migrations
still use `DATABASE_URL`/the local default. Normally leave this unset so both
use the same database. Local secret files and Wrangler state are gitignored.

Pass Wrangler options through the root dev command:

```bash
pnpm backend:dev --port 8788
pnpm backend:dev --ip 0.0.0.0
```

For a physical Expo device on a trusted development network, bind to `0.0.0.0`
and configure its API URL with your laptop's LAN address and Wrangler port.
`localhost` on the phone refers to the phone. Keep native transport exceptions
limited to development; simulator/emulator addressing depends on the target.

## Drizzle migrations and database tools

The first committed migration enables PostGIS. No GIS, user, or report tables
are introduced here: D-12 and the reporting decisions still govern those schemas.
There is therefore no seed data or destructive reset command in this foundation.

After agreeing on a domain schema:

1. Add tables to [`src/db/schema.ts`](src/db/schema.ts).
2. Run `pnpm --dir backend db:generate --name=describe-change`.
3. Review the generated SQL and commit the migration plus its `meta` files.
4. Run `pnpm --dir backend db:migrate` and `pnpm backend:check`.

For SQL that Drizzle cannot generate (such as extensions), use
`pnpm --dir backend db:generate --custom --name=describe-change` and fill in the
migration. Never modify a migration already applied by another developer.

Useful commands from the workspace root:

| Command                         | Purpose                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm --dir backend db:up`      | Start/wait for Docker PostGIS                                                                   |
| `pnpm --dir backend db:migrate` | Apply pending committed migrations                                                              |
| `pnpm --dir backend db:check`   | Verify Drizzle connection and PostGIS                                                           |
| `pnpm --dir backend db:studio`  | Open Drizzle Studio for the configured development database                                     |
| `pnpm --dir backend cf:typegen` | Regenerate ignored Worker types after Wrangler configuration changes                            |
| `pnpm --dir backend dev:node`   | Run the optional Node scaffold on port 3000; `/ready` is unavailable without a database checker |

Worker requests use their own `pg` client and close it after the operation;
Hyperdrive owns origin pooling when deployed. Inject database dependencies into
modules instead of sharing live clients across Worker requests. Migrations run
separately in Node, never inside API requests.

## Verification

After `backend:setup`, run:

```bash
pnpm --dir backend lint
pnpm --dir backend typecheck
pnpm --dir backend test:ci
pnpm backend:build
pnpm backend:check
```

Jest verifies application behavior, including readiness failure redaction.
`backend:check` verifies database connectivity, creates a Workers bundle without
deploying, and starts real local Workers on ports **18787/18788** to check liveness,
readiness through the Hyperdrive local binding/Drizzle/PostGIS, and structured
404 responses, then verifies a generic `503` with an unreachable database while
liveness stays available. Leave those test ports free. The test stops the Worker afterward;
it preserves the database. CI performs setup against a fresh Docker volume,
replays migrations, and runs the same integration check without cloud credentials.
The existing repository-wide `pnpm verify` remains available after setup.

## Local versus deployed behavior

```text
Local:    Expo/API client → Wrangler Worker → Docker PostGIS
Deployed: Expo/API client → Worker → Hyperdrive → managed PostgreSQL/PostGIS
```

Wrangler uses the local override to connect directly to PostgreSQL. Actual
Hyperdrive pooling/caching are bypassed, so a local pass does not verify those
features or production latency. The committed Hyperdrive ID is a local-only
placeholder; production deployment is not configured in this PR.

Before enabling remote development or deployment, provision separate staging
resources and record ownership, provider/region, budgets, backups, secrets, and
cache policy under D-10. Disable Hyperdrive query caching initially, especially
for future ownership/authorization/report reads. Do not rely on session settings
surviving transaction pooling. Validate the actual Drizzle/PostGIS queries and
latency through a staging deployment. A later `wrangler dev --remote --env staging`
uses real remote resources and ignores the local override; a staging environment
must first be configured explicitly.

The [implementation plan](../docs/tasks/first-task-implementation-plan.md)
records the broader hosting direction. [Architecture](../docs/architecture.md),
[API](../docs/api.md), [data model](../docs/data-model.md), and
[security](../docs/security.md) remain the domain references. GIS endpoints,
reporting/auth, R2/Queues/email, and production hosting are subsequent work.

References: [Express on Workers](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/),
[Hyperdrive local development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/),
[Drizzle integration](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/).
