# Develop against the combined mobile and GIS stack

`feat/mobile-gis-integration` combines the histories of PRs #2–#5 and adds the
mobile-to-GIS connection. PR #6 targets `main`, so its aggregate diff intentionally
includes those unmerged changes. Creating the integration branch does not merge
any PR into `main` or change the four source branches. No cloud deployment occurs.

## Check out the complete stack

In a clean clone or checkout with no local changes:

```sh
git fetch origin
git switch --track origin/feat/mobile-gis-integration
nvm use
pnpm install --frozen-lockfile
```

If that local branch already exists, use `git switch feat/mobile-gis-integration`
and `git pull --ff-only` instead. Check `git status` first and preserve local work.
If another task owns the current checkout, use a separate worktree:

```sh
git fetch origin
git worktree add -b work/my-feature ../cascade-my-feature origin/feat/mobile-gis-integration
cd ../cascade-my-feature
nvm use
pnpm install --frozen-lockfile
```

Otherwise, create your feature branch after checking out the integration branch:

```sh
git switch -c work/my-feature
```

Until the stack lands, target feature PRs at `feat/mobile-gis-integration` to show
only your changes. Do not push feature work directly to the shared integration
branch. To pick up later integration changes, commit your work, fetch, and merge
`origin/feat/mobile-gis-integration` into your feature branch. Worktrees share Git
history but not dependencies, ignored `.env` files, or generated Worker types.

## Start an isolated local backend

Docker Desktop must be running. These commands use their own Compose project,
volume, and port rather than the backend worktree's default database on 55432:

```sh
export COMPOSE_PROJECT_NAME=cascade-springs-integration
export CASCADE_DB_PORT=55433
pnpm backend:setup
pnpm --dir backend db:seed
pnpm backend:dev --ip 127.0.0.1 --port 8787
```

Keep the exports in terminals running backend setup/checks/Worker commands.
Use another free database port and Compose project name for another independent
stack on the same laptop. An explicit `DATABASE_URL` in your shell or
`backend/.env` overrides the generated port-based URL; verify your configuration
before migrating or seeding. Never seed a production database.

Before starting a server, check listeners (on macOS, for example):

```sh
lsof -nP -iTCP:8787 -iTCP:8082 -sTCP:LISTEN
```

Reuse an existing server only after confirming which worktree/database it serves.
Do not stop another developer's server. Select another Worker port if needed and
adjust the mobile API URL below. The [backend handoff](../../backend/GIS-HANDOFF.md)
documents API requests, public access, fixture metadata, and device addressing.

## Connect the installed iOS development client

In another terminal at this checkout's root, create `mobile/.env.local` with:

```dotenv
EXPO_PUBLIC_API_URL=http://localhost:8787/api/v1
```

This is public client configuration, not a secret. Preserve any existing local
configuration. Without the variable the map remains a basemap-only preview.
Production requires an approved HTTPS API; HTTP is accepted by the client only in
development. The URL must end at `/api/v1`, not `/layers`. Public catalog feature
URLs are resolved against the same server origin and validated before fetching.

```sh
nvm use
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
pnpm mobile --port 8082
```

Check for an existing Metro listener before starting another. Connect the
installed development build (in a separate terminal):

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun simctl openurl booted 'cascade-springs://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8082'
```

Environment-variable edits need a full app reload. If Metro does not pick up a
new local environment file, restart only your worktree's Metro process. Existing
MapLibre native dependencies suffice; no rebuild is needed for this JavaScript
integration. First-time build/install instructions are in the
[mobile README](../../mobile/README.md). Avoid `pnpm ios` with the older local
Xcode; use EAS `pnpm --dir mobile exec eas build --platform ios --profile development`,
then `pnpm --dir mobile exec eas build:run --platform ios --profile development --latest`, for native changes.
Android Emulator normally uses `http://10.0.2.2:8787/api/v1`; physical devices need
the laptop LAN address and an explicitly LAN-bound Worker. Android/device HTTP
transport and native behavior are not verified by this iOS check.

## Observable behavior and checks

After seeding, the demo GIS adds one purple dashed boundary polygon (the
approximate preserve boundary). The map automatically fits the returned geometry.
Rendering order keeps trails above polygons. This boundary is a hand-drawn guess,
unsuitable for navigation; the warning must remain visible. Blue landmarks are not the user's GPS position.

A missing API URL shows basemap-only status. An empty public result is distinct
from a failed request. API failure preserves basemap controls and shows Retry
layers. The client replaces the entire snapshot only after every collection is
validated; partial/invalid results are not presented as success. Requests time
out after 10 seconds and are cancelled on endpoint changes/unmount. Data is held
in memory only; there is no offline cache or automatic reconnect sync. This first
slice downloads full public collections without bbox/pagination; large datasets
need a later viewport/tiling strategy. No device location is requested or sent.

```sh
pnpm verify
pnpm --dir backend test:integration
pnpm backend:check
```

Backend checks require the same `CASCADE_DB_PORT` export as the integration
server. Run database test suites serially against the isolated development DB.
`backend:check` uses its own temporary Worker ports 18787/18788. Ordinary workspace
Jest skips the PostGIS tests, so the explicit integration command is separate.

On November 1, 2026, the installed EAS client on iPhone 16 / iOS 18.6 fetched all
five features through local HTTP. Native rendering and API-failure browsing,
app restart with API unavailable, and recovery through Retry layers were verified.
See the [loaded map](../images/ios-simulator-gis-integration.png) and
[unavailable state](../images/ios-simulator-gis-unavailable.png). No new native
compilation occurred. Android native behavior, manual tab-bar tapping, pan/pinch,
dynamic text-size checks, GPS, and offline persistence remain unverified/out of
scope. This integration does not close the complete J6-14 or J6-19 stories.

## Keep the integration branch current

Only the integration maintainer should update the shared branch. Fetch and merge
updated source branches into this branch, resolve conflicts while preserving
both sides' intended behavior, rerun verification, then push normally. Never
force-push source branches or `main`. Source PRs remain open until reviewed and
explicitly merged later.

## Later merge instructions

The recommended review path keeps the original focused PRs:

1. Review and merge backend foundation #2 into `main`, then retarget GIS #5 from
   `setup/workers-local-postgis` to `main`, verify its diff/checks, and merge #5.
2. Review and merge iOS setup #3 into `main`, then retarget map #4 from
   `setup/eas-ios-simulator` to `main`, verify its diff/checks, and merge #4.
3. In a clean integration checkout, run `git fetch origin`, then
   `git merge origin/main`. Resolve any conflicts, run `pnpm verify` plus the
   backend integration/Worker checks, and push the integration branch. Review
   PR #6 against `main`; only the connection and integration documentation should
   remain. Merge #6 after that review.
4. Retarget downstream feature PRs to `main` when their integration base has
   landed; update each feature branch and verify the resulting diff/checks.

Use **Create a merge commit** for the prerequisite PRs when repository settings
allow it, preserving the exact ancestors already in the integration branch.
Squash/rebase merges create different commit identities: if those methods are
required, reconcile the resulting trees carefully and inspect PR #6's final diff;
do not assume the stack disappeared from the commit list or blindly replay it.
Do not rewrite a shared integration branch that teammates already use.

An alternative, only after all included work is approved, is to merge #6 as the
single aggregate change. That lands the complete stack at once. Original PRs
would then need to be checked and closed/marked superseded as appropriate;
GitHub's handling depends on merge method and ancestry. Do not independently
reapply their changes. This is a later maintainer choice, not an action performed
when publishing this branch.
