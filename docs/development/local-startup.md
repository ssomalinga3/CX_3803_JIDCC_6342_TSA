# Run the complete local stack

This is the editable command runbook for [PR #6](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/6),
initially checked at commit `fa350c5`. Run commands from the repository root in
macOS Terminal with zsh or bash. Update the verification record below when the
commands or dependencies change.

The implemented end-to-end path is **iOS Simulator → Expo/Metro → local Wrangler
Worker → Docker PostGIS**, rendering three synthetic GIS layers and five features.
Reporting, authentication, email/S3, GPS, and durable offline storage are future
work; they have no local service to start in this PR. The online basemap requires
internet access. See the [integration guide](integration-branch.md) for branch
ownership and merge instructions, and the [backend guide](../../backend/README.md)
and [mobile guide](../../mobile/README.md) for component details.

## 1. Prerequisites and checkout

Install Git, GitHub CLI (`gh`), nvm, Docker Desktop, and Xcode with a compatible
iOS Simulator runtime. Open Xcode once to finish setup and accept its license.
An Expo account with access to `cx3803jidcc6342tsa` is needed only to obtain/build
the native development client. Expo Go cannot load MapLibre.

Check for local changes before switching. In an existing clean checkout:

```sh
git status --short
git fetch origin
git fetch origin pull/6/head
git switch -c work/pr-6-local FETCH_HEAD
```

Use a new branch name if it already exists. This also works when the PR's source
branch is checked out in another worktree. If already on PR #6 or a branch based
on it, skip the checkout commands. Do not discard existing changes.

Load nvm if your shell has not loaded it, then install the pinned tools and workspace:

```sh
source "$HOME/.nvm/nvm.sh"
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
node --version
pnpm --version
```

Expected: Node `v24.21.0`, pnpm `10.26.2`. On subsequent days, `nvm use` is enough.
Install dependencies once at the root; keep the root lockfile. In noninteractive
automation use `CI=true pnpm install --frozen-lockfile` to avoid pnpm's reinstall prompt.

Start Docker Desktop and wait until its engine is ready:

```sh
open -a Docker
docker info
```

Check for occupied ports before starting servers:

```sh
lsof -nP -iTCP:55434 -iTCP:8787 -iTCP:8082 -iTCP:18787 -iTCP:18788 -sTCP:LISTEN
```

No output (exit code 1) means no listeners. Confirm ownership before reusing any
existing service. This guide uses a dedicated Compose project/database on 55434;
other worktrees may use 55432/55433. If ports conflict, choose free ports and update
every corresponding command, API URL, and simulator link below. Worker checks
use fixed ports 18787/18788.

## 2. Terminal A: database and API

Use the same exports in every terminal that runs backend setup, tests, or shutdown:

```sh
nvm use
export COMPOSE_PROJECT_NAME=cascade-springs-local
export CASCADE_DB_PORT=55434
pnpm backend:setup
pnpm --dir backend db:seed
pnpm backend:dev --ip 127.0.0.1 --port 8787
```

Keep the last command running. Setup generates Worker types, starts PostGIS,
applies migrations, and checks a query through Drizzle. Seeding is repeatable.
On later starts, repeat this block to apply any new migrations and fixtures.
No Cloudflare account or cloud deployment is needed.

`db:seed` publishes the approximate preserve boundary (the `demo-boundaries`
layer). After pulling a change to the seed fixtures, re-run `db:seed` against the
same database the Worker reads (match `CASCADE_DB_PORT`) and reload the app.

Before setup, review any existing `backend/.env` and shell overrides locally.
Normally no backend environment file is needed. `DATABASE_URL` overrides the
port-derived development URL; `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`
overrides only the Worker's connection. Leave both unset for these defaults, so
the API and migration/seed/check commands use the same database. Do not migrate
or seed a remote database. Never paste credentials into this document.

## 3. Terminal B: verify the live API

```sh
curl --fail --silent --show-error http://127.0.0.1:8787/health
curl --fail --silent --show-error http://127.0.0.1:8787/ready
curl --fail --silent --show-error http://127.0.0.1:8787/api/v1/layers
```

Expect health `status: ok`, readiness `status: ok` and `database: ok`, and a
catalog containing `demo-boundaries`.
This executable smoke check asserts collection types and counts without printing
geometry:

```sh
nvm use
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:8787';
const get = async (path) => {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, path);
  return response.json();
};
assert.deepEqual(await get('/ready'), { status: 'ok', database: 'ok' });
const { layers } = await get('/api/v1/layers');
for (const [id, type, count] of [['demo-boundaries', 'Polygon', 1]]) {
  assert.ok(layers.some((layer) => layer.layerId === id && layer.isDemo));
  const collection = await get(`/api/v1/layers/${id}/features`);
  assert.equal(collection.type, 'FeatureCollection');
  assert.equal(collection.features.length, count);
  assert.ok(collection.features.every((feature) => feature.geometry.type === type));
}
console.log('PASS: PostGIS → Worker → demo boundary layer / 1 feature');
NODE
```

The exact counts assume only the seeded public catalog. Reconcile expectations
when adding public data.

## 4. Native iOS client: first time only

Skip cloud compilation if a development client matching this checkout's native
dependencies/configuration is already installed. Inspect available simulators:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun simctl list devices available
open -a Simulator
```

Select an iPhone in Simulator's File → Open Simulator menu. For shell-only boot,
use `xcrun simctl boot <device-UDID>` with an actual ID from the list; skip this if
already booted. Wait for startup with:

```sh
xcrun simctl bootstatus booted -b
```

If you need a development client, use the lockfile-pinned EAS CLI:

```sh
nvm use
pnpm --dir mobile exec eas login
pnpm --dir mobile exec eas whoami
pnpm --dir mobile exec eas build --platform ios --profile development
pnpm --dir mobile exec eas build:run --platform ios --profile development --latest
```

Wait for a successful build before installing. Cloud builds consume organization
quota; reuse a compatible build when available. Do not create/relink an EAS
project. The `development` profile targets the simulator; physical-device signing
is separate. Rebuild after native dependency or Expo configuration changes.
JavaScript edits use Metro/Fast Refresh. Local `pnpm ios` compilation requires a
compatible newer Xcode; the established workflow uses cloud compilation.

## 5. Terminal B: configure and start Metro

Create the ignored local configuration only if it does not already exist:

```sh
test -f mobile/.env.local || cp mobile/.env.example mobile/.env.local
```

Edit `mobile/.env.local`, preserving any other settings, so it contains:

```dotenv
EXPO_PUBLIC_API_URL=http://localhost:8787/api/v1
```

This is a public URL embedded in the bundle. It must end at `/api/v1`, not
`/layers`. Restart this checkout's Metro and fully reload the app after changing
it. Without this value, the app runs a basemap-only preview.

```sh
nvm use
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
pnpm mobile --port 8082
```

Keep Metro running. In Terminal C, connect the installed development client:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun simctl openurl booted 'cascade-springs://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8082'
```

Expect the demo GIS to add one purple boundary polygon (the approximate preserve
boundary), alongside the source-map trails and landmarks, fitted into view. Keep
the synthetic-data warning visible. No location permission is requested.
Check pan/pinch, zoom, and Return to preserve manually.

For failure/retry verification, stop **only Terminal A's Worker** with Ctrl+C.
Reload the app; expect API unavailable and **Retry layers**, with basemap browsing
still available. Restart Terminal A's dev command, then tap **Retry layers**;
expect all five features again. This checks recovery, not offline persistence.

## 6. Automated verification (Terminal C)

Run after setup and seeding, using the same database. Run database suites serially:

```sh
nvm use
export COMPOSE_PROJECT_NAME=cascade-springs-local
export CASCADE_DB_PORT=55434
pnpm verify
pnpm --dir backend test:integration
pnpm backend:check
git diff --check
```

`verify` runs formatting, lint, type checks, Jest, and iOS/Android JavaScript bundle
exports. The explicit integration suite exercises real PostGIS; `backend:check`
builds the Worker without deploying and checks real HTTP/database behavior,
private/unknown-layer restrictions, invalid bbox input, and database failure.
JavaScript exports, native compilation, and simulator interaction are separate
evidence. Formatting failures in untouched files should be reported separately.

## 7. Shutdown and restart

Ctrl+C in the Worker and Metro terminals. Stop this guide's database without
removing its volume:

```sh
export COMPOSE_PROJECT_NAME=cascade-springs-local
export CASCADE_DB_PORT=55434
pnpm --dir backend db:down
```

Next time, repeat sections 2 and 5, then open the client from Terminal C.
Keep `.env.local`; rebuild the native client only when needed. Do not use
`docker compose down -v` if you want to retain local data.

## Other targets and troubleshooting

- **Android Emulator:** use `http://10.0.2.2:8787/api/v1`. A compatible Android
  development build/toolchain is needed; this runbook's native verification is iOS.
- **Physical phone:** bind the Worker with `--ip 0.0.0.0` on a trusted network and
  use the laptop's LAN address in the API URL. The phone must also reach Metro.
  Simulator localhost addressing will not work on a phone. Development HTTP
  transport depends on the installed native build; production requires HTTPS.
- **Docker not ready:** wait for `docker info` to succeed, then rerun setup.
- **Missing Worker types:** rerun `pnpm backend:setup` before type checks.
- **Empty GIS:** confirm you seeded the same database the Worker uses.
- **Stale API URL:** restart this checkout's Metro and reload the app. Check for
  another server on 8082 before clearing caches or stopping processes.
- **No installed client / simctl unavailable:** follow section 4 and check
  `DEVELOPER_DIR`; Metro does not build a native app.
- **Web:** `pnpm web` shows the native-map requirement; it does not verify MapLibre.

## Verification record

Update this section after rerunning the commands. Record the date, commit,
environment, passed checks, blockers, and native/device limitations separately.

Verified November 1, 2026 (America/New_York), against PR #6 commit `fa350c5`
plus these documentation changes, on branch `docs/pr-6-local-startup`:

| Check                   | Result                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Environment             | macOS 15.7.9, Xcode 16.4, iPhone 16 / iOS 18.6; Node 24.21.0, pnpm 10.26.2, Docker 28.3.2                                                              |
| Dependency installation | `CI=true pnpm install --frozen-lockfile` passed; lockfile unchanged                                                                                    |
| Fresh local database    | `backend:setup` and `db:seed` passed with a newly created `cascade-springs-local` volume on 55434                                                      |
| Live API                | Worker on 8787; health and the exact Node smoke-check block above passed: three layers / five features                                                 |
| Native rendering        | Existing EAS development client connected to this checkout's Metro on 8082; screenshot inspected, all five features and synthetic-data warning visible |
| Workspace verification  | `pnpm verify` passed: formatting, lint, type checks, 24 backend unit tests (9 DB tests skipped here), 32 mobile tests, iOS/Android JavaScript exports  |
| Database integration    | `pnpm --dir backend test:integration`: all 33 backend tests passed, including the 9 DB cases                                                           |
| Worker verification     | `pnpm backend:check` passed: PostGIS readiness, Worker dry-run build, HTTP/GIS/access checks, database-unavailable response and liveness               |
| Restart                 | `db:down`, `backend:setup`, and `db:seed` passed again using the retained database volume                                                              |
| Documentation           | Prettier, relative file-link checks, and `git diff --check` passed                                                                                     |

Sandboxed installation/HTTP tests initially failed because registry/local socket
access was restricted; rerunning with the required host permissions passed.
The existing simulator client was reused; no new EAS cloud build or installation
was performed. Build/install flags were checked against the pinned EAS CLI help.
Node and pnpm were already installed, so first-time `nvm install` / `corepack enable`
were not rerun. Manual pan/pinch, Retry layers tapping, dynamic text sizes, Android
native execution, and physical-device transport were not rerun in this verification.
GPS, report queues, permission-denial flows, and offline restart/sync are not
implemented by this PR and cannot be claimed as passing acceptance paths.

After verification, the database (55434), Worker (8787), and Metro (8082) were left
running for local use. Use section 7 to stop them without deleting database data.
