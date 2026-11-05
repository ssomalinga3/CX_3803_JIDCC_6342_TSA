# Public feature details — J6-20

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
