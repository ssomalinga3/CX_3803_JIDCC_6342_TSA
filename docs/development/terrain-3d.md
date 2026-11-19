# 3D terrain and trails — J6-54

The owner requested work from `main` and confirmed on November 18, 2026 that
this slice includes **3D terrain and trails only**, using the existing USGS
subset. New 2D contour/ring work is deferred. This implements the separate
renderer portion of [J6-54](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-54)
under [J6-5](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-5).
J6-53's broader production device/memory/field acceptance remains open; the
bounds below are implementation guards, not client-approved budgets.

## Interaction

Choose **GIS Layers → Map view → 3D terrain**, then Done. The owner explicitly
requested an in-place replacement, with no map-entry button or separate route,
and location support in 3D. Map view is a session choice independent of basemap,
presets and overlay switches. The selector is the last card in Choose GIS Layers.
In 3D, preset, GIS overlay and 2D elevation controls remain visible, dimmed and
disabled (including their expanded source choices and optional native offline
download actions). Base map remains available in both modes and supplies the
selected tiles draped over the 3D ground. Switching to 2D re-enables retained choices.
The native viewport remains full size but hidden during 3D; returning to 2D
recreates its surface, restores the saved camera and reattaches all selected GIS.

3D covers three times the original model's width and height (nine times its
projected area), using a separately preserved USGS subset at the same sampling
density. It shows selected basemap tiles, public trails clipped to the actual
elevation footprint, and the consented device position. Crossing trails retain
their covered portions. It excludes landmarks, boundaries, roads, water,
buildings, signal and reports from the GIS catalog. Normal roads and place names
belonging to the selected basemap remain background context. The 2D choices remain saved.

Elevation-derived hillshade uses a northwest sun fixed to the map, warm highlights
and muted shadows to reveal ridges and gullies. A separate local DEM source avoids
sharing the terrain mesh's rendering buffers. Shading sits above tile colors and
below labels, trails and GPS; geometry remains at true vertical scale. Existing
provider hillshade is omitted to avoid applying two different lighting models.

Pan, pinch, two-finger rotation/tilt, one native Tilt button, shared zoom and Return to
preserve controls operate on the active renderer. Heights use metres/NAVD88 at
true vertical scale. The shared location control retains permission denial,
Settings recovery, stale-fix removal, explicit recenter/follow and drag-to-stop.
3D retains tilt while following; recenter restores a 60° view. A fix outside the
bounded terrain has an explicit coverage message and cannot recenter beyond
the model. Entering 3D alone never requests permission. Turning location off
clears its WebView source. GPS stays on the device and is absent from logs.

The trail key retains the existing palette. Leaving Map or backgrounding
releases the WebView; return/foreground recreates it from the retained 3D camera.
GIS settings retain the normal Done/iOS swipe-back/Android Back behavior.
The dimmed settings group keeps a permanent native parent so Android Fabric
does not reparent offscreen controls when the bottom mode selector changes opacity.

Loading is bounded to 15 seconds with explicit Retry/return on WebGL, WebView,
asset or rendering failure. Missing/out-of-coverage/oversized data has a usable
fallback, shared Retry layers, GIS settings and **Use 2D map**.

## Assets and reproducibility

MapLibre GL JS 5.24.0 runs inside react-native-webview 13.16.1 (Expo SDK 57).
The packaging script copies the pinned installed browser distribution, CSS and
upstream license into a generated JSON asset. No CDN is used. The Python
converter verifies the committed USGS GeoTIFF checksum and generates RGB DEM
tiles at zooms 14–15 / 256 pixels and a shaded fallback surface. Mapbox RGB
encoding quantizes metre heights to 0.1 m, with no accuracy claim. EPSG:3857 and
NAVD88 metre heights remain unchanged. There is no database/API/import change.
Outside-subset DEM padding extends edge values to avoid artificial cliffs;
the fallback surface stops at the actual source footprint. The original 2D
USGS source/assets and catalog imports are unchanged. The 3D source is
`data/cascade-springs-gis/sources/usgs-3dep-3d.tif` with a matching acquisition
record. It is 1,536 × 1,152 cells, EPSG:3857, 7,079,918 bytes, no missing cells,
and contains approximately 245.64–319.64 metre heights. The converter verifies
source hash and exact 3× projected width/height against the original source.

From the workspace root:

```sh
pnpm install --frozen-lockfile
node mobile/scripts/package-terrain-renderer.mjs
node mobile/scripts/package-terrain-renderer.mjs --check
uv run --locked --project tools/gis python tools/gis/convert_terrain_3d.py
uv run --locked --project tools/gis python tools/gis/convert_terrain_3d.py --check
uv run --locked --project tools/gis python -m unittest discover -s tools/gis -p test_convert_terrain_3d.py
# Deliberate future acquisition; review output before copying into sources/:
uv run --locked --project tools/gis python tools/gis/fetch_national_elevation.py --terrain-3d
```

Terrain is 2,639,533 bytes, including 13 DEM tiles and the fallback image;
renderer/CSS/license is 1,146,754 bytes. Generators reject more than 4 MB of
terrain, 25 DEM tiles or 2 MB of renderer data. Trails are limited to 500 KB.
Rendering uses one worker, at most 96 cached tiles across sources, pixel ratio
capped at 2, zoom 14–19 and pitch at most 75°. These limits do not
measure actual process/GPU memory or establish older-device support.

The generator also writes `elevation-metadata.json`, containing coverage and
attribution without tile/image strings. Normal 2D startup reads only this small
manifest. The large DEM and renderer modules are evaluated only when a visible
3D renderer builds its document; full trail clipping is also skipped in 2D.

## Offline and security

The WebView bundles its renderer, terrain and fallback image, using an exact-key
DEM protocol. Selected tiles/style/glyphs/sprites load only from the established
OpenFreeMap and USGS HTTPS hosts allowed by CSP. No CDN script is fetched. A fixed synthetic
HTTPS base origin makes inline WKWebView scripts/workers usable; it serves no
remote page. Navigation permits only that exact bootstrap URL and `about:blank`.
File access, browser geolocation, shared cookies and new windows are disabled.
Feature HTML, arbitrary URLs and metadata never cross the bridge. Only the
consented current position enters its local map source. Camera/gesture messages
are limited to 256 characters and validate version, session, numeric coverage,
zoom/pitch/bearing and finite timing. No bridge payload is logged. Retry creates
a new renderer attempt; stale attempts cannot mark it ready. Source changes
retain and reapply the local position. Tile requests reveal the viewed area to
the selected provider, as in 2D; raw GPS fixes are not separately uploaded.

Terrain becomes usable independently of tile loading. Tile/style loading has a
12-second budget. Failure removes remote sources, restores bundled terrain and
offers explicit **Retry map tiles** without provider switching. No repeated
automatic retry or remote error/URL logging is introduced. Basemap changes in
3D leave the hidden native renderer's style unchanged until returning to 2D.

Saved public GIS retains existing cache/source validation. After one successful
GIS load, bundled terrain and saved covered trails can open after offline
restart. Basemap tiles require network access; this WebView does not consume
native MapLibre offline packs. Without saved trails the missing-data state
applies. This does not add tile-pack downloads or report queues.

## Native rebuild and acceptance

WebView is a new native dependency. Rebuild both development clients in the
existing Expo project:

```sh
pnpm --dir mobile exec eas build --platform ios --profile development
pnpm --dir mobile exec eas build --platform android --profile development
```

Use iOS 26 as the primary development runtime and verify Android afterward.
Run `pnpm verify`, generator checks and `git diff --check`. Separately verify:

1. GIS settings → 3D: terrain, covered trails and optional blue location replace Map.
2. Pan/zoom/rotate/tilt/recenter; GIS settings → 2D restores its prior context.
3. Background/foreground, repeated entry/exit and Android system Back.
4. Offline restart with saved GIS, without a GPS permission prompt.
5. Missing data, renderer failure/unsupported state and explicit retry.

## iOS refinement evidence

The rebuilt EAS iOS development client `a90274b4-6b61-4af0-91eb-47b2852dbf99`
ran on Cascade iOS 26 / iOS 26.3. The local API on 8787 reads the unchanged
existing `cascade-signal-check` database on 55435: ten catalog layers, nine
chooser switches. The earlier hosted API has only the old two-layer catalog
and is unsuitable for checking restoration of the full original chooser.

Observed on iOS: bottom-placed map mode controls; dimmed/disabled 2D options;
restored nine original controls in 2D; fresh native surface with GIS/basemap on
return; 36 supplied trail sections in 3D; consented blue location/follow and
stale-fix removal; selected Standard tiles over the enlarged terrain; shaded
ridges/gullies with labels and trails above the hillshade. The first bounded
terrain renderer measured about 1.7 s startup before the later extent expansion;
this is not a performance measurement of the final expanded/tiled renderer.

The Android acceptance and hidden-renderer checks below follow the iOS refinement.
No physical-device, field-accuracy, screen-reader, final GPU memory or production
performance acceptance is claimed.

Earlier full automated gate: `pnpm verify` passed formatting, workspace lint/types,
11 simulator-walk tests, 130 backend unit tests, 204 mobile tests, and iOS/Android
JavaScript exports (8.7/8.9 MB Hermes bundles). The 30 opt-in database integration
cases were skipped by the unit runner; this slice does not change database
behavior. All 34 pinned GIS tests, renderer/terrain reproducibility checks and
`git diff --check` passed. The walk HTTP test required host localhost socket
access; the full gate passed after that sandbox restriction was removed.

## Android acceptance and hidden-renderer lifecycle

The fresh EAS Android development build `39f22559-3596-4bf5-8b2e-fdc1591ae56c`
compiled successfully and was installed on **Cascade_API_36 / Android 16 / API 36
ARM64**. Metro 8082 served this feature worktree; API 8787 used the same unchanged
full-catalog database as iOS. No generated native project edits were needed.

Observed: Standard vector tiles and USGS Aerial raster tiles draped over the
expanded terrain; hillshade and all 36 trail sections; one Tilt control; pan,
zoom, return to preserve, blue simulated GPS and recenter; bottom mode controls;
disabled 2D settings and re-enabled retained choices; Android system Back;
Researcher restoration with nine layers / 779 selected-source features.
After fixing the settings parent, three further complete 2D → 3D round trips
passed native assertions for restored GIS and 36 trail sections without a crash.
Location refusal preserved browsing and showed Settings recovery. The app opened
Android's app-permission settings; restoring foreground precise access restored
the blue simulated fix in 3D. Original location permissions and connectivity were
restored after the checks.

For offline restart, the emulator's Wi-Fi/mobile data and API forwarding were
temporarily disabled while Metro remained reachable through ADB. A cold app
restart loaded saved GIS, and 3D showed bundled terrain plus all 36 saved trail
sections with location off and no permission prompt. Remote tiles reported
unavailable and exposed explicit retry. Connectivity/forwarding were restored
and both tile and GIS retry were exercised. These changes affected only the
test emulator; the shared database/API were untouched.

Android WebView DevTools inspection found one terrain page, one worker and one
canvas while visible. Settings, Explore, 2D and background checks settled at zero
terrain pages/workers. Android may defer React native unmount during backgrounding,
so the browser's hidden event also disposes its map immediately. Foreground and
focus activation always give the renderer a new generation, including batched
background/resume transitions. iOS retains native focus/AppState cleanup because
WKWebView can report a transient hidden event during navigation.

This establishes **no ongoing hidden 3D rendering, worker or tile requests** in
the checked paths, not zero total memory cost: the packaged assets increase the
app/bundle size, and evaluated asset modules or platform caches can remain in
memory after first use. There is no claim of a physical-device CPU/battery budget.
Regression tests reject large asset evaluation during 2D startup and cover focus,
background disposal, batched resume, failed tiles and idempotent map disposal.
An iOS 26.3 follow-up confirmed 2D GIS restoration and shaded Standard 3D reload.

Final follow-up checks passed mobile lint/types, all **206 mobile tests**, both
Hermes bundle exports, terrain/renderer reproducibility and `git diff --check`.
See the [Android Standard tiles and simulated GPS](../images/terrain-3d-android.png)
and [Android offline restart](../images/terrain-3d-android-offline.png) screenshots.
Native two-finger gestures and physical-device performance remain unverified;
the emulator smoke used the single Tilt control, zoom buttons and drag gestures.
