# Test the same change on iOS and Android on this Mac

Use one checkout, one Metro server and one GIS API/database for both simulators.
The helper at `scripts/macos/mobile-simulators.mjs` connects installed development
clients; it never switches branches, compiles native code, seeds/migrates data or
stops existing services. MapLibre requires development clients, not Expo Go.

## Daily commands for contributors and agents

Select the checkout containing the change you intend to test. The helper lives
in this workspace, but `MOBILE_WORKTREE` can point it at another existing worktree
without switching branches or modifying that worktree's source. It prints the
selected path, branch and commit for every command. To test another existing
worktree, replace the example path below with its absolute path:

```sh
export MOBILE_WORKTREE="/absolute/path/to/the/checkout-to-test"
export EXPO_PUBLIC_API_URL=http://localhost:8787/api/v1
```

Set these in each command terminal. Omit `MOBILE_WORKTREE` only when deliberately
testing this helper's own checkout. In particular, `gis/04-terrain` predates the
cell-signal renderer: it will draw imported signal observations as generic large
blue landmark dots. The local `update/gis-stack` worktree contained the full
preview when setup was verified; it includes pending features and is not a claim
that those features are merged into main. Inspect current PR/branch state before
choosing a target.
Use a different free Metro port for another worktree and never point a simulator
at an older checkout while describing it as the latest feature preview.

From the selected worktree, select the Node version in `.nvmrc` and pnpm version in
`package.json`. Start the existing project database/API if needed, following
[local startup](local-startup.md). Reuse a healthy existing API rather than
creating a second database for Android.

Boot the existing iOS simulator in Simulator and the Android AVD in another
terminal, if they are not already running:

```sh
emulator -avd Cascade_API_36 -memory 3072
```

This Mac has `Cascade iOS 26` on iOS 26.3 and `Cascade_API_36`, a Pixel 7 with
Android 16 / API 36, Google APIs and `arm64-v8a`. Do not launch a second copy of
the same Android AVD. Wait for its Home screen before connecting.

Check the selected worktree's `mobile/.env.local` locally. Both platforms should use the same public API
address, currently:

```dotenv
EXPO_PUBLIC_API_URL=http://localhost:8787/api/v1
```

This is ignored local configuration; do not commit it. Expo SDK 57's development
virtual-env module merges `.env`, `.env.development`, `.env.local`, then
`.env.development.local` over the shell value. A terminal export alone can
therefore leave the app using an older file value. Preserve other developers'
configuration and restart Metro after an intentional API change. Never store
credentials in public Expo variables.

Start shared Metro in a dedicated terminal:

```sh
node scripts/macos/mobile-simulators.mjs start
```

In a free terminal, open both installed clients:

```sh
node scripts/macos/mobile-simulators.mjs open both
node scripts/macos/mobile-simulators.mjs status both
```

`open` checks API/database readiness, Metro's EAS project and checkout identity before
connecting. It forwards the Android emulator's Metro and loopback API ports to
the Mac, then opens both clients on the same bundle server. iOS accesses the Mac's
loopback directly. Both use the same GIS database and see the same JS/TS edits.
While running, `start` restores Android forwarding every five seconds after an
emulator reconnect. After restarting Metro or Android, rerun `open both` to
reopen the clients.
Android is closed and reopened to avoid a development-client React-context crash
when changing servers; this resets its session-only UI state.
The status command checks services, installed clients and booted devices; it does
not establish visual acceptance.

Use `open android`, `open ios`, `status android` or `status ios` for a single
platform. With multiple devices, set `ANDROID_SERIAL` and/or
`IOS_SIMULATOR_UDID`. Set `METRO_PORT` for an alternative port, using the same value
for `start`, `open` and `status`. `DEVELOPER_DIR` overrides the helper's default
`/Applications/Xcode.app/Contents/Developer`; no global Xcode selection changes.
The helper binds Metro to IPv4 loopback to match its native manifest URLs.
It refuses to use a Metro manifest whose bundle points at a LAN-only
address, since that would give the simulators different addressing requirements.

## Shared backend on this machine

Setup reused `cascade-signal-check-db-1` on host port `55435`, with a Worker on
`8787`. If that API is not already running, start it in its own terminal:

```sh
export CASCADE_DB_PORT=55435
pnpm backend:dev --ip 127.0.0.1 --port 8787
```

The container/port are machine state, not changed repository defaults. Check
`docker ps` and `/ready` before choosing a backend. Use the existing database's
Compose project and port for maintenance; do not migrate or seed another
worktree's database to run a mobile smoke check. During setup an older Worker on
8788 was unresponsive and was left untouched. A temporary Android-specific
database was stopped; its volume was retained. The running simulators share the
original database. No existing database data was changed for emulator setup.

## Installed Android tools and native clients

The SDK is at `~/Library/Android/sdk`, with command-line tools, platform-tools,
emulator, Android 36 platform and build-tools 36.0.0. Java was already installed.
Android Studio is optional for this command-line workflow. `~/.zshrc` now contains:

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

Open a new terminal, or export those values in the current terminal, then check:

```sh
adb version
emulator -list-avds
emulator -accel-check
```

Google's [command-line tools](https://developer.android.com/tools) and
[Expo's emulator guide](https://docs.expo.dev/workflow/android-studio-emulator/)
describe installing SDK packages elsewhere. Intel Macs require an x86_64 system
image. SDKs, AVDs, APKs and credentials stay outside the repository.

Android setup reused completed [EAS build ec347c51](https://expo.dev/accounts/cx3803jidcc6342tsa/projects/cascade-springs/builds/ec347c51-7934-48b5-af04-baafe07bf03d),
which includes ARM64 libraries. Its `app.json`, `package.json` and `eas.json`
matched this checkout when installed. To install an existing build later:

```sh
pnpm --dir mobile exec eas build:run --platform android --id ec347c51-7934-48b5-af04-baafe07bf03d
```

Artifacts can expire. After native dependency/plugin/configuration changes, build
a new development client and install its ID:

```sh
pnpm --dir mobile exec eas build --platform android --profile development
```

Preserve the existing EAS project and application identifiers. For iOS client
installation/rebuilds, follow the [mobile guide](../../mobile/README.md).
Ordinary JS/TS edits use the shared Metro instance and Fast Refresh.

## Smoke checks and boundaries

Compare Map, GIS overlays/layer selection, Explore and navigation back to Map on
both platforms. Verify the actual change's acceptance path separately on each;
passing JavaScript exports, lint, type checks or a native build does not establish
device acceptance. Location consent/denial, offline restart/retry, physical-device
behavior and accessibility need their own checks in
[user flows](../design/user-flows.md).

Close the emulator normally when finished, and use Ctrl+C in Metro's terminal.
Keep shared backend services running while another developer/simulator uses them.
Do not wipe AVD data or delete database volumes to fix connection problems.

## Verification record

November 15, 2026: Android 16 ARM64 booted with Hypervisor.Framework acceleration;
the existing Android development APK installed and launched. Both Android and
Cascade iOS 26 / iOS 26.3 connected to the same checkout's Metro on 8082 and the
same local API on 8787, backed by the existing PostGIS database on 55435. Both
rendered the supplied trails, boundaries, landmarks and terrain with the same
visible summary (9 layers, 779 features; the catalog contains 10 layers and the
terrain chooser selects one of the two elevation sources). Explore navigation
was verified on both platforms. Android's initial map timeout recovered using
Retry; an asset connection warning exposed dropped forwarding and led to the
launcher's reconnect recovery. Software rendering can make the first load slow.

The shared helper's `start`, `open both` and `status both` were exercised. Node
syntax validation, mobile lint/type checks, formatting and `git diff --check`
passed. No native build, dependency update, migration, seeding, new reporting/GPS
acceptance or offline persistence verification was performed. The native clients
were reused. Checks here establish the local test environment, not complete
feature acceptance.

### Cell-signal display correction

The initial setup served `gis/04-terrain` from the primary checkout against a
database that already contained cell-signal observations. That older app classified
all Points as landmarks, making signal observations large and blue on both
platforms. The renderer itself had not regressed. Both clients were reconnected
to `.work/pr-final-stack` (`update/gis-stack`, `8371b2d`), which contains the small
class-colored, dark-outlined signal layer and excludes it from landmark styling.
The helper now accepts `MOBILE_WORKTREE` and prints checkout/branch/commit so
agents can distinguish a main acceptance check from a pending-stack preview.
No branch was switched and neither app source nor database data was changed.

The preview starts with the Visitor preset, which hides signal observations.
Enable **Cell-signal observations** in the layer chooser (or use Researcher) to
compare the small dots and class legend. Their visibility is session state;
Android's clean `open` resets it. Blue/gray landmark dots remain a separate layer.

Both native simulators were visually checked after enabling the signal layer:
small red/orange/yellow/green dots, separate blue/gray landmarks, the five-class
key, and the same 4-layer/736-feature summary. The preview's existing signal
regression suite passed all 11 tests. The integrated worktree remained clean.
