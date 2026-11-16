# Cloudflare backend and Neon operations

Deployment configured and verified November 12, 2026, from the isolated checkout
`/Users/theohalpern/Documents/GitHub/CX_3803_JIDCC_6342_TSA-cloudflare`, branch
`infra/cloudflare-backend`. The implementation agent's checkout is untouched.

## Hosted resources

| Resource                   | Value                                                               |
| -------------------------- | ------------------------------------------------------------------- |
| API                        | <https://cascade-springs-api.dcc-6342-tsaa.workers.dev>             |
| Cloudflare account         | `DCC-6342-TSAA`, `9b52bc25ebc019f660636e493cc8ad51`                 |
| Worker                     | `cascade-springs-api`                                               |
| Hyperdrive                 | `cascade-springs-db-production`, `463ed66cfeaa43179f85b9bb0d3eecbd` |
| Neon organization          | `org-snowy-boat-51273621`                                           |
| Neon project               | `cascade-springs`, `super-violet-75535709`                          |
| Neon branch                | `production`, `br-noisy-mode-bd3x836q`                              |
| Database                   | `cascade-springs`                                                   |
| Database versions observed | PostgreSQL `18.6`, PostGIS `3.6.4`                                  |
| Region                     | AWS US East (Ohio), `aws-us-east-2`                                 |
| Runtime role               | `cascade-springs-api`, scoped read-only                             |

```text
Mobile → HTTPS Worker → Hyperdrive → Neon PostgreSQL/PostGIS
Main push → successful CI → migrations → Worker deployment → HTTP verification
```

The initial setup uses one hosted database, as directed by the project owner.
Local development and CI retain their existing Docker PostGIS databases. Their
PostgreSQL 16 image/volume was not upgraded during this task; PostgreSQL 18 was
verified separately through the actual hosted database and local/deployed Workers.

No custom domain or Cloudflare Git connection is required. The repository can
remain under `ssomalinga3`. The separate GitHub Actions workflow deploys using a
scoped Cloudflare token. The previous personal Cloudflare account is unused by
this production binding.

## Configuration and secrets

The root `.env.local` is gitignored and has owner-only file
permissions. Neon CLI writes `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, branch
identifiers and `NEON_FUNCTION_HOST_SUFFIX` there; the latter does not enable a
Functions service. The existing generated `neon.ts` policy was preserved with
Postgres as the only utilized service. Auth, Functions, storage, Data API and AI
Gateway were not provisioned.

[`.env.example`](../../.env.example) lists the hosted values. `CASCADE_RUNTIME_DB_URL`
contains the separate direct read-only login, stored privately after provisioning.
The public account ID and `API_ORIGIN` are also set in `.env.local`.

Ordinary commands continue to load `backend/.env` and use local Docker. Explicit
`backend:hosted:*` commands load root `.env` when present, otherwise `.env.local`;
shell variables take precedence. They require a direct PostgreSQL URL with TLS,
prefer `DATABASE_URL_UNPOOLED`, and enforce certificate/hostname verification.
They do not silently fall back to the local database. For local Worker testing
against Neon, they use the runtime login when available.

Production Workers read `HYPERDRIVE.connectionString`; database credentials are
held by Hyperdrive rather than committed in Wrangler configuration or included
in mobile bundles. The existing `pg` + Drizzle connection-per-request architecture
is retained. See [the backend guide](../../backend/README.md) and
[security requirements](../security.md).

Hyperdrive query caching is disabled and its origin connection limit is five.
Hyperdrive uses its default `require` TLS mode, which Cloudflare documents as
validating public certificates using WebPKI. Its explicit `verify-full` mode
requires an uploaded CA certificate and was rejected without one. Direct Node
connections use `sslmode=verify-full`. See
[Hyperdrive TLS support](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/#supported-tls-ssl-modes).

Stored Worker observability and preview URLs are disabled. Review independent
logging/tail/export settings before collecting visitor location data. Never log
connection URLs, passwords, request bodies or visitor coordinates.

## Day-to-day commands

Run from the persistent deployment checkout using the pinned Node and pnpm:

```bash
nvm use
pnpm install --frozen-lockfile
neon deploy
pnpm backend:hosted:check
npm run build
pnpm --dir backend lint
pnpm --dir backend typecheck
pnpm --dir backend test:ci
```

`neon deploy` applies `neon.ts` and refreshes the Neon-managed variables in the
root private env file. It preserves custom Cloudflare/runtime settings. It does
not deploy the Worker or apply Drizzle migrations. A browser sign-in requires
the user to finish authorization; on a failed/timed-out Neon login, run
`neon login` and retry. Wrangler login is separate: use
`pnpm --dir backend exec wrangler login` when necessary.

To apply reviewed, backward-compatible schema changes and deploy:

```bash
pnpm backend:hosted:migrate
pnpm backend:deploy
pnpm backend:hosted:smoke
```

Stop on any failure. Migrations run before the new Worker, so they must remain
compatible with the currently deployed version. Worker rollback does not undo
schema changes. Use a planned maintenance or expand/contract rollout for
destructive changes.

To run the real local Worker against Neon on an unused port:

```bash
pnpm backend:hosted:dev --port 18879 --ip 127.0.0.1
```

The standard `pnpm backend:dev` remains a local Docker workflow. Do not run
`db:seed`, `test:integration` or `test:fresh` against production; those tests use
synthetic fixtures and mutations. Hosted verification uses actual API reads and
a separate permission check for the read-only role.

## GIS data publication

The deployed snapshot is the committed main-branch code at `45a4ccd` plus these
hosting changes: two public layers and 18 features. The implementation agent is
working on further GIS imports in a separate checkout. No uncommitted data or
code from that checkout was deployed.

After reviewing and merging a dataset change, publish its selected layers with:

```bash
pnpm backend:hosted:import
pnpm backend:hosted:smoke
```

The import is transactional and repeatable but replaces selected public layers;
CD deliberately does not import data on every merge. Use the updated importer
and expected counts from the reviewed commit. Do not publish demo or private
report data as GIS. The smoke test requires a nonempty, non-demo public catalog
and nonempty GeoJSON for each published layer.

## Enable continuous deployment

The [deployment workflow](../../.github/workflows/deploy-backend.yml) is prepared.
It is **not enabled yet**: it must be reviewed/merged to `main`, receive the two
secrets below, and have the enable variable set. No GitHub settings or secrets
were changed during this setup.

In [repository Actions settings](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/settings/secrets/actions),
add repository secrets:

| Name                    | Value                                                    |
| ----------------------- | -------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Deployment token scoped to the shared Cloudflare account |
| `DATABASE_URL_UNPOOLED` | Direct owner/migration URL from root `.env.local`        |

Use **Edit Cloudflare Workers**, scope it to account
`9b52bc25ebc019f660636e493cc8ad51`, and include Hyperdrive binding access if
needed. Do not use a global API key or put tokens into tracked files. See
[Cloudflare CI authentication](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

Then add repository variable **`BACKEND_CD_ENABLED=true`**. Collaborators can
create repository secrets in a personal-account repository; environment secrets
require its owner. If access is denied, ask the owner to perform the setup once.
[GitHub permissions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

The workflow waits for the existing `CI` workflow to succeed on a main-branch
push, checks out that exact SHA, skips superseded runs, migrates, deploys and
checks the hosted API. PR runs cannot deploy. It uses repository secrets and
requires no owner-managed GitHub environment. Disable Cloudflare Workers Builds
Git auto-deployment so another pipeline cannot bypass CI. Do not enable CD until
the migration account and Cloudflare token are correctly scoped.

## Rollback and recovery

Disable the deployment workflow and wait for running deployments to finish.
Select a known-good version from deployment history:

```bash
pnpm --dir backend exec wrangler deployments list --env production
pnpm --dir backend exec wrangler rollback REPLACE_KNOWN_GOOD_VERSION_ID --env production
pnpm backend:hosted:smoke
```

Initial verified Worker version: `8bfad9c4-4601-4b1d-9e35-46b6bbba6e8b`.
Fix/revert main before re-enabling CD. Database schema/data recovery uses Neon's
restore process, independently of Worker rollback. The project reported a
six-hour restore history at setup; no restore exercise was performed. Assign a
recovery owner and verify the retained history against the team's needs under
[D-10](../decisions.md).

## Verification recorded

- `neon deploy`: production policy matched; five Neon variables pulled privately.
- Committed Drizzle migrations applied; PostGIS readiness passed on PostgreSQL 18.
- Committed GIS import: two layers, ten trail sections and eight landmarks.
- Read-only runtime role: SELECT allowed, INSERT denied on GIS tables.
- `npm run build`: TypeScript and Worker bundle passed, gzip approximately 380 KiB.
- Backend lint/typecheck passed; nine Jest suites passed (65 tests, 16 DB integration tests skipped).
- Started a local Worker and verified readiness, two layers, 18 features and 404s through Neon.
- Deployed Worker and verified HTTPS health/readiness, public GeoJSON, cache headers, invalid bbox and unknown-layer 404s through Hyperdrive.
- Native mobile builds/device flows, a database restore exercise and a GitHub CD run remain unverified.

## Agent tooling audit and setup changes

Fetched and followed the exact requested
[Neon skill](https://neon.com/.well-known/agent-skills/neon/SKILL.md); its bytes
matched the installed skill. The Postgres skill recommends `pg` with Hyperdrive
for Cloudflare, matching this app.

The requested `npm i -g neon@latest` installed CLI **9.4.0**. `neon init` installed
the user-level `neon-postgres` plugin for Codex, Claude Code and VS Code; that
plugin includes Neon MCP at `https://mcp.neon.tech/mcp` and seven Neon skills.
For detected Copilot/Kiro integrations, it installed the user-level skills and
MCP URL configuration. Copilot's executable was unavailable, so its plugin
installation used that skills/MCP fallback. The initialization was rerun after
pnpm required explicit workspace-root dependency installation; final installed
states were confirmed. All seven skills report up to date. Existing project
configuration was preserved, and no duplicate project MCP config was added.

Repository changes: ignored `.neon` project selection, generated `neon.ts`, root
`@neon/config`/`@neon/env` dependencies and lockfile; hosted commands/configuration,
regression checks, env templates, CD workflow and this runbook. Private env files
contain credentials and are excluded from Git. Worker type generation now excludes
Node-only `.env` entries to keep types reproducible without publishing secret
names as required Worker bindings. No schema or mobile runtime code was replaced.
