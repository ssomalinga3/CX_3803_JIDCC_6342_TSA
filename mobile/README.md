# Cascade Springs mobile

Expo SDK 57 / React Native 0.86 / TypeScript starter application. The Map tab renders an initial native basemap preview; follow the team's Figma prototype and [project specifications](../docs/README.md) when feature work begins.

## First-time iOS Simulator setup

Use EAS cloud compilation and a local iOS Simulator. Local JavaScript development uses Metro; a macOS upgrade is not part of this workflow. MapLibre requires a development client and cannot run in Expo Go.

Install Xcode and an iOS Simulator runtime supported by your installed Xcode. Open Xcode once to complete its setup and accept its license. In Xcode Settings → Locations, select the installed Xcode under Command Line Tools. If you prefer a shell-only selection instead of changing the system setting:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun simctl list devices available
```

Keep that environment variable in terminals used for simulator commands and Metro. This selects existing Xcode tools; it does not upgrade Xcode. If no devices are available, install a compatible iOS runtime through Xcode Settings and create an iPhone simulator. Cloud compilation and local runtime compatibility must be verified separately.

Use the shared pnpm workspace and root lockfile. Run all commands below from the repository root:

```sh
nvm use
pnpm install --frozen-lockfile
pnpm --dir mobile exec eas login
pnpm --dir mobile exec eas whoami
pnpm --dir mobile exec eas build --platform ios --profile development
```

Your Expo account needs access to the `cx3803jidcc6342tsa` organization. The app is already linked to `@cx3803jidcc6342tsa/cascade-springs`; do not create another EAS project or change its application identifiers. The existing `development` profile builds an iOS Simulator development client, without physical-device signing or an Apple Developer Program membership. EAS cloud usage is subject to the organization's plan and available build quota. Never commit access tokens or credentials.

Wait for EAS to report a successful build, then install it:

```sh
pnpm --dir mobile exec eas build:run --platform ios --profile development --latest
pnpm mobile
```

The install command selects the latest build from the iOS `development` profile and prompts for a simulator. To install a specific completed build, use its build ID instead:

```sh
pnpm --dir mobile exec eas build:run --platform ios --id <build-id>
```

With Metro running, press `i` to open the installed development client, or `Shift+i` to choose a simulator. Verify that the starter home screen loads, switch to Explore and back, reload from Metro with `r`, and close/reopen the app while Metro remains running. No backend or local `.env` is required for the starter.

## Daily development

```sh
nvm use
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
pnpm mobile
```

Press `i` to open the app. JavaScript and TypeScript edits use Fast Refresh; restarting Metro does not require another cloud build. Run `pnpm --dir mobile exec eas build --platform ios --profile development` and `pnpm --dir mobile exec eas build:run --platform ios --profile development --latest` again after adding/updating native dependencies or changing native app configuration/plugins. Ensure the installed build matches your checkout's native dependencies.

`pnpm ios` compiles locally and is reserved for a compatible local toolchain. Expo SDK 57 requires Xcode 26.4 or newer for compilation; older Xcode can still provide the local simulator if the cloud-built app supports its runtime. Revisit host upgrades if cloud native rebuilds become a workflow bottleneck. Android native setup remains separate.

## Parallel work with another branch

Keep each agent in its own persistent worktree. From the original checkout, create a sibling worktree for an existing, unoccupied mobile branch:

```sh
git worktree add ../CX_3803_JIDCC_6342_TSA-ios setup/eas-ios-simulator
cd ../CX_3803_JIDCC_6342_TSA-ios
nvm use
pnpm install --frozen-lockfile
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
pnpm mobile --port 8082
```

If this worktree already exists, enter it instead of adding it again. Keep branch switches, installs, edits, and commits inside the relevant worktree. Worktrees share Git history but have separate files and dependencies. Servers and simulator devices are shared across the laptop: use distinct ports and connect the development client to the mobile worktree's Metro server. The starter has no backend dependency, so its smoke check does not validate a concurrent backend PR.

## Verified simulator baseline

On November 1, 2026, [EAS development build 4470b233](https://expo.dev/accounts/cx3803jidcc6342tsa/projects/cascade-springs/builds/4470b233-efec-4569-87f1-37672d1a5adc) compiled successfully, installed, and ran on an iPhone 16 simulator with iOS 18.6, using macOS 15.7.9 and Xcode 16.4. Metro served the starter from the separate mobile worktree on port 8082. Home rendering, Explore navigation through `cascade-springs://explore`, its File-based routing disclosure, Metro reload, and app close/reopen were verified. Automated tab-bar tapping was not verified because the UI automation tool could not send coordinate clicks; test the tabs manually using the steps above. See the [home-screen capture](../docs/images/ios-simulator-starter.png).

The cloud build used the existing starter native dependencies; this PR adds workflow commands and documentation. This establishes simulator compatibility for that build, not physical-device, GIS map, offline, or backend acceptance. `pnpm verify` passed separately from native compilation and simulator verification.

## Troubleshooting

- **`simctl` unavailable:** select full Xcode tools or set `DEVELOPER_DIR` as above; standalone Command Line Tools do not contain the simulator.
- **No development build installed:** wait for the cloud build to finish and run `pnpm --dir mobile exec eas build:run --platform ios --profile development --latest`. `pnpm mobile` only starts Metro.
- **Wrong/stale build:** install by the exact EAS build ID. Rebuild after native dependency/configuration changes.
- **Cannot connect to Metro:** keep Metro running in this checkout; use the server address it prints in the development client. Restart with `pnpm mobile --clear` if its cache is stale.
- **EAS login/project access failure:** check `eas whoami` using the command above and ask an organization owner to grant access. Do not relink the project.
- **Install/launch fails on an older runtime:** retain the build URL and simulator error. A successful cloud build alone does not establish local compatibility; report the blocker before changing Expo or upgrading macOS.

## Checks and project structure

```sh
pnpm verify
```

This runs formatting, lint, type checks, Jest, and iOS/Android JavaScript bundle exports across the configured workspace. Jest tests starter interactions and theme selection with native mocks. Bundle checks do not compile or launch a native app; record EAS compilation and simulator smoke results separately.

Routes live in `src/app/`; components and hooks live outside that directory. `ios/` and `android/` are generated and ignored. Change native configuration through Expo config/plugins, then rebuild.

See [Expo's simulator build workflow](https://docs.expo.dev/build-reference/simulators/) and the historical [development setup guide](../docs/old-plans/expo-setup.md). Use this README for the current local iOS workflow.

## Native map preview (J6-14, first slice)

The Map tab uses the already-installed MapLibre React Native 11.5 renderer with
[OpenFreeMap Liberty](https://openfreemap.org/quick_start/) online tiles. No token,
backend, new native dependency, or new development build is required for this
slice. It follows the floating header and map controls from
[Figma active navigation](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=17-26),
with a truthful preview panel in place of the unimplemented reporting dock.
Native map attribution remains available through the map information button.
The public basemap's trails/boundaries are not approved Conservancy GIS layers.
The initial viewport is only a browsing center, not a measured preserve boundary.

Start Metro with `pnpm mobile --port 8082` in this worktree. If needed, connect the
installed simulator client explicitly (with `DEVELOPER_DIR` set as above):

```sh
xcrun simctl openurl booted 'cascade-springs://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8082'
```

Verify that tiles and labels load, pan/pinch, use zoom in/out, and use Return to
preserve. Explore remains the starter screen. No location permission is requested;
browsing works with location off. If initial loading fails or remains incomplete
for 20 seconds, check the visible connection message and Retry. This is an online
preview, with no offline coverage guarantee. The web route explains the native
build requirement instead of importing native MapLibre.

Remaining dependencies for the complete
[J6-14](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-14) flow:

- Approved GIS data, provenance/license, layer properties, and a finalized public
  API contract (D-05); do not substitute fabricated trails or infer off-trail safety
  from this basemap.
- Foreground GPS consent, denied/unavailable/stale-fix states, and blue-dot/recenter
  behavior (J6-15). Native permission configuration will require an EAS rebuild
  with `pnpm --dir mobile exec eas build --platform ios --profile development`, then `pnpm --dir mobile exec eas build:run --platform ios --profile development --latest`.
- Production basemap/provider approval and offline region/zoom/storage policy
  (D-05/D-06). OpenFreeMap here is a development preview choice.
- Approved trail tolerance before off-trail warnings (J6-24), and later layer,
  reporting, and emergency flows. These controls are not represented as working
  actions in this slice.

On November 1, 2026, native tile/label rendering, Zoom in, and Return to preserve
were verified on the existing iPhone 16 / iOS 18.6 development build through Metro
on 8082. See the [map capture](../docs/images/ios-simulator-map-preview.png).
The native map differs from Figma's gray placeholder by rendering live basemap
data; no Figma placeholder map/blue-dot artwork is shipped as GIS content.
Tab-bar tapping remains manual: the automation tool returned `noWindowsAvailable`
for coordinate clicks. Pan/pinch, offline/device failure recovery, Android device
behavior, and dynamic text-size checks remain unverified. Jest separately covers
native-render readiness, viewport controls, failure/retry, and load timeout.
This slice does not close J6-14.

## API-backed GIS integration

The combined branch connects the Map tab to the public catalog/GeoJSON API from
PR #5. Follow the [integration guide](../docs/development/integration-branch.md)
for a single-branch checkout, isolated backend setup, `EXPO_PUBLIC_API_URL`,
Metro/device addressing, verification, and later PR merge instructions. Earlier
basemap-preview sections record the PR #4 baseline; this branch additionally
renders server-provided geometry and its demo warning. No new native dependency
or app configuration was introduced by that integration slice.

## Foreground map GPS (J6-14)

The Map tab now offers **Use my location**, requests foreground permission only
after that action, and draws a blue position dot from `expo-location`. **Recenter
on my location** centers on the latest fix; **Return to preserve** remains a
separate action. Position updates move the dot without pulling the camera away
from manual browsing. Reported accuracy is displayed in meters, including coarse
fixes when the OS grants approximate location.

The location subscription exists only while the Map screen is focused and the
app is in the foreground. Turning location off, changing tabs, or backgrounding
removes the subscription and clears the displayed fix. Returning to the map
rechecks permission and reacquires a fix if location was enabled. Denial preserves
pan/zoom; permanent denial offers device Settings. Disabled device services,
missing GPS, stale fixes, and map/API network failures have separate messages.
No coordinates are persisted, logged, or added to GIS API requests.

Display freshness is currently 30 seconds: no initial fix produces an unavailable
message, and a fix older than 30 seconds loses its dot and recenter action until a
fresh fix arrives. This is an engineering display default, not an approved
off-trail buffer or an accuracy guarantee. Off-trail detection remains J6-24/25.
Offline tile/GIS downloads remain separate; GPS does not require a GIS API call.
The project owner instructed us on November 4 to assume the current GIS data is
correct for this GPS work; that assumption does not establish production dataset
approval or remove the demo provenance labels.

### Rebuild before running

This change adds a native module and location permission configuration. Existing
clients may lack the module or the permission text; install a rebuilt client
before native acceptance checks. From the workspace root, use the existing
team-owned EAS simulator profile:

```sh
pnpm ios:build
pnpm ios:install
pnpm mobile --port 8082
```

See [local startup](../docs/development/local-startup.md) for Xcode selection,
API startup and the development-client URL. No generated native projects are
edited. Background location and Android location foreground services are disabled.
Implementation follows the [SDK 57 location API](https://docs.expo.dev/versions/v57.0.0/sdk/location/).

### Acceptance checks

1. Open Map without enabling location. Confirm GIS/pan/zoom work and no OS prompt
   appears. Tap Use my location; verify the native explanation and deny it.
   Confirm browsing still works and the blue dot/recenter remain unavailable.
2. Enable location in device Settings, return to Map and supply a simulated fix.
   Confirm the blue dot and reported accuracy. Tap recenter, pan away, then move
   the simulated position: the dot moves but the camera stays where you left it.
   Tap recenter again to move to the new fix.
3. Disable device services or remove the simulated fix. Verify unavailable/stale
   feedback and that old coordinates are not presented as current. Restore the
   fix and confirm recovery. Test approximate permission on supported devices.
4. Switch tabs, background/resume, turn location off, and revoke permission in
   Settings. Verify cleanup, permission recheck, and no repeated automatic prompt.
5. Repeat the location checks with networking unavailable, keeping the distinction
   between GPS availability and missing uncached map tiles. Repeat on supported
   Android hardware/emulator separately from iOS.

Automated checks: `pnpm --dir mobile lint`, `pnpm --dir mobile typecheck`,
`pnpm --dir mobile test:ci`, and `pnpm bundle:check`. Native compilation and these
device checks are separate evidence; see the verification record below.

### GPS verification record

The [updated map/GPS acceptance record](../docs/development/map-gps-acceptance.md)
covers the PR #11/#12 re-import, native iOS permission/lifecycle/failure checks,
and the subsequent services-off feedback correction. The earlier build record
below remains separate evidence.

November 4, 2026: `pnpm verify` passed (formatting, workspace lint/type checks,
24 backend tests, 45 mobile tests, iOS/Android JavaScript exports; 9 existing
database integration cases are skipped by this default command). Mobile tests
include location denial, permanent
denial, missing/stale/invalid fixes, simulated movement/recenter, permission-dialog
lifecycle, background and tab cleanup, permission revocation, late native
subscriptions, inactive-to-active startup, and retry. The first sandboxed workspace
run could not open the backend tests' loopback sockets; the permitted rerun passed.

[EAS iOS development build 628c6f51](https://expo.dev/accounts/cx3803jidcc6342tsa/projects/cascade-springs/builds/628c6f51-d666-49e0-86ad-e36ef661225c)
compiled successfully and was installed/launched on iPhone 17 Pro / iOS 26.3.
The client connected to this checkout's Metro on 8082. The updated native
foreground-permission explanation, permission grant, blue-dot rendering,
reported accuracy, movement along a synthetic 1 m/s route, recentering clear of
the information panel, stale-fix fallback, Map/Explore return without another
permission prompt, explicit location disable, and zoom with location off were
visually checked. Denial/Settings fallback was also inspected in the running
client before installing the rebuild. See the [GPS screenshot](../docs/images/ios-simulator-map-gps.png).
The simulated route was cleared and map location turned off after verification.

The latest JavaScript adjustments (including camera padding) were served by Metro
after native installation. These do not change the native module/configuration.
Android native execution, physical-device/approximate GPS, full Settings recovery,
manual pan/pinch, background/resume on device, dynamic text sizes, and
network-disabled device behavior remain unverified. Background/permission
revocation and cleanup are covered with native mocks, which do not establish
device acceptance. Offline map persistence and off-trail warnings are not part of
this slice.
