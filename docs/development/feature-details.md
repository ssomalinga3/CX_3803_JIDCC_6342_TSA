# Public feature details — J6-20

## Android Done correction — J6-70, November 16, 2026

[J6-70](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-70) reproduced on the
existing Android 16 / API 36 ARM64 development client (`Cascade_API_36`). The
full-screen native modal drew its header under the system status-bar touch area.
Tapping the visible Done label left Waterfall details open, although Android
Back dismissed them. The close callback was already wired correctly.
Native captures show [the unresponsive label](../images/android-feature-details-before.png)
and [the inset header after the fix](../images/android-feature-details-after.png).

The Android header now adds the current top safe-area inset to its existing
20-point padding. iOS keeps its native page-sheet spacing. This moves the entire
Done target below the status bar/cutout without changing selection, camera,
location, GIS requests or native configuration. The inset updates with layout
changes; it is not a fixed status-bar height.

Regression coverage checks Android's nonzero/zero inset layouts, inset changes,
iOS page-sheet spacing and both dismissal callbacks. All 165 mobile tests, mobile
lint/type checks, formatting, iOS/Android JavaScript exports and
`git diff --check` passed. Existing map tests cover repeated selection and GPS
watcher/camera invariance.

Native Android verification uses this checkout's Metro on 8084 and the restored
local Worker/PostGIS on 8787/55435. Repeated Waterfall/Bailey Art Plaza opening,
Done and system Back dismissal passed, retaining the viewport and Visitor's
3 layers / 59 features. Both dismissal paths also retained an enabled GPS session
with synthetic emulator fixes and an available recenter control. The iOS 26.3 simulator loaded the same GIS map, but
computer-use coordinate taps failed with `windowNotFoundAtPosition`; native iOS
sheet interaction remains unverified. No new native compilation, physical-device,
screen-reader or large-text certification is claimed. No API/schema change is
required.

During verification, Docker's shared Linux file-handle pool was exhausted by
processes in another project's container. After its owner-approved restart,
PostgreSQL became healthy, `/ready` returned `database: ok`, and all 10 layers /
808 features were intact. See [local recovery guidance](local-startup.md#other-targets-and-troubleshooting).
Temporary development GIS request overrides were removed; final native Android
verification uses the real local database.

## Original implementation record

[J6-20](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-20) adds a reusable
detail sheet for public GIS features. It starts from main `f4e3fbb` and uses the
already-loaded catalog/GeoJSON; there are no API, database, dependency or native
configuration changes. Start the existing [local stack](local-startup.md).

## Interaction and data handling

- Tap a rendered public feature. Native MapLibre source hit-testing supplies IDs;
  a landmark takes precedence over an overlapping trail, then a polygon. Equal
  geometry priority is resolved deterministically by ID. Duplicate rendered hits
  do not create multiple sheets. The device dot and basemap are separate sources.
- The current validated snapshot supplies every displayed field. The loader's
  in-memory feature-to-layer map supplies exact provenance, including IDs with
  slashes. Ambiguous combined IDs fail loading rather than attach wrong metadata.
  Native event properties and local `_display_*` render attributes are not shown.
- Show bounded name, description, type, layer, source and available
  pillar/difficulty/surface/length-in-meters. Missing values are omitted or use a
  name/description fallback. No coordinates or arbitrary/raw JSON are displayed.
- Source HTML becomes bounded native Text: script/style/comment/tag content is
  removed as appropriate and common entities decoded. There is no WebView, image
  request, automatic URL activation, upload, log or detail network request.
  This is text extraction for native Text, not an HTML sanitizer for later reuse
  in a web renderer. Standing caveats remain in Disclaimers.
- Done, iOS modal dismissal, accessibility escape and Android request-close share
  the dismissal handler. The map remains mounted. The sheet changes neither GPS
  opt-in nor the camera target. Map blur and snapshot replacement/unavailability
  discard the selection. There is no persistence across app restart.

The draft uses the app's themed rounded cards and a native page sheet. Direct
Figma fetch failed, the browser host was unavailable, and Chrome access was
denied. Exact Figma alignment requires owner review. No full history-detail or
proximity flow is claimed; layer selection is separate J6-19 work.

API references: [MapLibre source press events](https://maplibre.org/maplibre-react-native/docs/components/sources/geo-json-source/)
and [React Native Modal](https://reactnative.dev/docs/0.86/modal).

## Verification record

Verified November 5, 2026 (UTC; local evening November 4) on the existing iPhone
17 Pro / iOS 26.3 development client via Metro 8082 and Worker/PostGIS 8787/55434.
No new native build or installation was performed.

- Native taps opened a Spring landmark, Terrace Trail segment and approximate
  preserve boundary. Description, type, layer and source matched the data; the
  boundary showed the missing-description fallback. Done dismissed and allowed
  another selection with map controls/GIS still present and location off. The
  [screenshot](../images/ios-feature-detail-sheet.png) shows boundary details.
- Regression tests cover overlap priority/deduplication, unknown IDs/native data,
  inert HTML/entity extraction and bounded text, missing/unsupported properties,
  exact layer provenance/combined-ID collisions, modal/native dismissal, reselect,
  snapshot replacement/failure, tab blur and unchanged GPS watcher/camera calls.
- `pnpm verify` passed: formatting, workspace lint/types, all 71 mobile tests,
  42 backend unit tests (14 real-database cases skipped by this command), and
  iOS/Android JavaScript bundle exports. Backend/schema behavior is unchanged;
  the previously passing 56-test fresh-PostGIS suite was not repeated for this
  mobile-only ticket. Relative document file links and `git diff --check` passed.

Not established: live Figma alignment, Android native execution, a new native
build, full VoiceOver focus/gesture interaction, large-text layouts, every
overlap/zoom case, or device-wide network-disabled behavior. GPS/camera invariance
is regression-tested with native mocks; the complete native walking-session
matrix was not repeated. Durable offline restart/retry and layer-toggle acceptance
remain separate unfinished work. Jira stays In Progress pending draft review.
