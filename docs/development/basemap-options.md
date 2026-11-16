# Multiple basemap options — J6-68

The Base map card in Choose GIS Layers offers nine keyless online styles, grouped
by provider. Select a row to apply it immediately and collapse the menu. Done,
iOS swipe and Android system Back retain choices. The owner confirmed immediate
behavior during implementation, superseding the original plan's draft/cancel
flow. A fresh session uses OpenFreeMap Standard (Liberty).

[Draft PR #47](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/47)
is the top entry of native GitHub stack #46, above PR #34. All preceding entries
merged during development. GitHub requires at least two entries to create a
native stack, so this PR extends the existing stack; it is the only unmerged
entry. Its individual base is `infra/cloudflare-backend`, and the stack trunk
remains `main`. The parent file tree stayed identical across automatic restacks
and the final main merge; only ancestry changed. The original uncommitted
[provider plan](../tasks/basemap-options-plan.md) is retained with its implementation
amendment. No parent PR was merged by this feature.

## Enabled catalog and evidence

Provider metadata and catalogs were rechecked November 15, 2026. A service refresh
date is not an imagery acquisition date. Source metadata can change independently
of an app release.

| Provider          | Styles                                                    | Native source detail and attribution                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenFreeMap       | Standard / Liberty, Light / Positron, Bright, Dark, Fiord | Vector tiles through z14, overzoomed by MapLibre. All five current style documents use the OpenFreeMap glyph endpoint and Noto Sans, matching preserve labels. Credits: OpenFreeMap, OpenMapTiles, OpenStreetMap.                |
| USGS National Map | Aerial, Topographic, Aerial + Topographic, Shaded Relief  | 256 px Web Mercator tiles, ArcGIS `/tile/{z}/{y}/{x}`. Fetch through z16; camera continues to z19 by overzoom. Full service copyright strings are included in source attribution; concise visible credits remain above the dock. |

Official sources:

- [OpenFreeMap mobile quick start and style catalog](https://openfreemap.org/quick_start/).
- [USGS service inventory](https://www.usgs.gov/faqs/what-are-base-map-services-or-urls-used-national-map).
- [Aerial metadata](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer?f=pjson): mainly NAIP, CONUS 2017–2021; service refreshed June 2024. Preserve-specific acquisition date remains unverified.
- [Topographic metadata](https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer?f=pjson): refreshed September 4, 2026.
- [Aerial + Topographic metadata](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer?f=pjson): refreshed April 2026.
- [Shaded Relief metadata](https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer?f=pjson): refreshed September 2025.

USGS metadata advertises levels through z23, but its documented useful large-scale
content ends around 1:9,028. The app deliberately uses z16 source tiles and enlarges
them at closer zoom. Native screenshots show approximate alignment and limited
imagery detail; they do not establish survey accuracy or local acquisition dates.
Basemap context is separate from approved preserve features and hit-testing.

## Configuration and eligibility

No map key, provider account, new dependency or backend configuration is needed.
`EXPO_PUBLIC_API_URL` continues to configure GIS independently. An unavailable
API does not disable the basemap menu or Done.

The existing `EXPO_PUBLIC_OFFLINE_MAP_STYLE_URL`, when authorized and configured,
adds a separate **Offline prototype** choice. Its original offline download
controls remain. Online resource checks do not gate cached offline packs. This
feature defaults to Standard; choose the configured offline map explicitly.
These online entries do not enable offline bulk downloads or create a server
cache, tile relay, proxy or new pack implementation.

MapTiler and Stadia remain primary keyed candidates; Thunderforest, Geoapify,
ArcGIS and Jawg remain research candidates. **None is activated.** No actual
Free-only account settings, native-app eligibility or public key was supplied.
The [zero-charge gate](../tasks/basemap-options-plan.md#zero-charge-rule-for-app-visible-keys)
requires dated official evidence and actual dedicated-account settings, including
hard rejection at the free limit, no paid billing linkage, no payment/invoice or
auto-upgrade/additional-usage path, and a public read-only map key. Public-key
values alone do not satisfy it; a billing alert or app-side counter is insufficient.
Do not add a provider to the shipped registry before clearing that gate and its
native quality/attribution requirements. No keys are accepted by this release's
registry, and no provider signup or billing changes were performed.

## Rendering and recovery

`basemaps.ts` is the typed allowlist. `MapGisProvider` owns the selected ID
separately from snapshot/preset/terrain state. Invalid IDs resolve to Standard.
The menu renders no previews, thumbnails or downloads for unselected styles.

The Map retains its React/native instance across selection and retry. GIS IDs,
terrain assets, source validation, hit priority and layer order are unchanged.
Changing a style suppresses layout-driven refitting; explicit Retry also preserves
the viewport. Existing location blur/resume behavior remains in its own hook.
Provider attribution is visible and accessible above the dock; complete USGS
credits remain in the native attribution control. Detailed caveats are in the
shared Disclaimers source.

`useBasemapLoad` combines native full rendering with an abortable health check of
only the selected style, its primary current-viewport tile and a Noto Sans glyph.
It rejects HTTP failures (including 401/403/429), empty resources, JSON/HTML error
responses and missing sources. Vector metadata is resolved before requesting one
sample tile. The whole attempt is bounded by 20 seconds. Obsolete requests are
aborted and obsolete handlers cannot complete/fail the current attempt.

Failure replaces remote basemap sources with a neutral background, retaining
local GIS and camera, to stop native failed-source traffic. **Retry** makes one
new attempt. **Use Standard map** explicitly selects Liberty; if Standard itself
failed, it retries it. There is no automatic fallback/provider/retry loop. No
provider request URL, credential or viewport coordinate is logged by app code.

This checks representative HTTP availability at selection/retry time, alongside
native map failure events; it cannot certify every viewport tile, detect a
nonempty but visually blank image, identify precise quota causes from native
events, or monitor every later provider outage. Error wording therefore remains
“Map unavailable,” not a claimed quota diagnosis. Provider caching can affect
failure timing; a successful cached map is not complete offline coverage.

## Verification

Automated tests cover all catalog choices, missing/empty/failed/loading GIS,
immediate selection/reopen/session reset, stable native instance and camera,
separate presets/counts, both terrain sources and refresh fallback, obsolete
request cancellation, explicit retry/fallback, GPS watcher preservation, glyph/
tile/auth/quota failures, and bounded silent failure. No live free allowance was
exhausted. The inherited terrain version/hash/placement rejection tests remain.

Native checks use the existing development clients (no native dependency/config
changes), the primary checkout's Metro at `8083`, and the existing Worker/PostGIS
at `8787`. JavaScript exports, existing native clients and simulator observations
are separate evidence; no fresh native compilation is claimed.

Automated checks passed from the primary checkout with Node 24.21.0 and pnpm
10.26.2: `pnpm verify` (formatting, lint, both type checks, **130 backend tests**,
**163 mobile tests**, iOS and Android JavaScript exports) and `git diff --check`.
The backend runner skips its 30 database-integration tests without the opt-in
integration environment; those were not claimed here. The native clients exercised
the existing live Worker/PostGIS data separately. Web static export also passed,
retaining the native-build information screen. Initial sandbox attempts could not
bind backend test ports; the successful verification ran outside that restriction.
The primary checkout's pinned dependencies and generated Cloudflare types were
prepared using the documented install/typegen commands.

Native verification took place November 15–16, 2026:

| Acceptance path                                  | iOS 26.3 simulator                                                                                          | Android 16 / API 36 ARM64 emulator                                                                                                                                                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nine styles, attribution and overlay restoration | All nine rendered; [gallery](../images/basemaps/ios-styles.jpg)                                             | All nine reached ready with Visitor 3 / 59; [gallery](../images/basemaps/android-styles.jpg)                                                                                                                                                                           |
| Both terrain sources                             | USGS 8 / 102 and Supplied 8 / 98; close labels and relief over dark/aerial content                          | USGS 8 / 102 and Supplied 8 / 98 retained through style changes                                                                                                                                                                                                        |
| Camera / native navigation                       | Zoomed viewport retained across styles and source changes; Done/reopen verified                             | Zoomed viewport retained; system Back retained immediate selections                                                                                                                                                                                                    |
| Public feature details                           | Existing automated tap/priority coverage; native tap could not be driven through the computer-use connector | Tapped Old Building over aerial imagery, read correct landmark/source, dismissed with system Back                                                                                                                                                                      |
| Location denial                                  | Denied the system prompt; browsing and Light selection stayed available                                     | Denied the native prompt; Standard browsing and controls remained available. A later Light attempt failed transiently and explicit Standard recovery succeeded                                                                                                         |
| Failure / explicit recovery                      | Controlled HTTP/glyph/tile/timeout cases automated                                                          | Transient Bright failure preserved local GIS; one explicit Retry recovered. Controlled raster HTTP 429 fixture: one attempt, one extra request on explicit Retry, then Use Standard map recovered with 8 / 98 and the same zoomed viewport; fixture restored afterward |

Android UI checks use adb, explicitly authorized after the computer-use connector
could not attach to the standalone emulator. The emulator itself hung once (QEMU
watchdog), was restarted without wiping data, and reconnected to the primary
checkout. This is distinct from an app crash or provider quota failure.

Remaining limits: no new native compilation, physical-device/field-alignment
validation, actual provider quota exhaustion, offline-pack download/restart,
large-text visual pass, VoiceOver/TalkBack session, or all-tiles coverage guarantee.
GPS lifecycle and all-hidden behavior retain their inherited automated coverage.
No reporting, recipient privacy or server-access contract changed.

The Android 429 fixture temporarily substituted only the selected Aerial tile
health response in the development runtime; it did not exhaust a real provider
allowance, modify source code, or leave a fixture in the app. Native rendering
alone could not clear the failure. Exactly two rejected checks were observed:
one selection and one explicit Retry. Standard fallback restored ready browsing
and retained Supplied DTM 8 / 98. The original network client was then restored.

[Native acceptance screenshots](../images/basemaps/acceptance.jpg) show terrain,
feature details, the grouped chooser, location denial and explicit recovery.
The galleries are reduced copies of native captures, not interface mockups.
