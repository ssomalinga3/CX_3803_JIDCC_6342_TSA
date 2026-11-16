# J6-68 — Multiple basemap providers and one source menu

Status: implemented keyless catalog; see the [current implementation and verification](../development/basemap-options.md).

Implementation amendment, November 15, 2026: the owner confirmed that basemap
choices apply immediately, matching the current stack's presets and layer controls.
Done, swipe and system back retain choices. This supersedes the draft/cancel
requirements below. The implementation started from PR #34 / `ee86762` (subsequently restacked by GitHub
with an identical file tree as lower PRs merged), containing
the merged terrain work, newer presets, layer ordering, offline prototype and
shared simulator workflow. Nine eligible keyless styles ship. Keyed providers
remain research candidates; no account or zero-charge settings were supplied.
The research below is retained as dated evidence, not an activation approval.

Jira: [J6-68](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-68).
Proposed draft PR title: **Add grouped basemap choices from multiple free providers**.

Revision 2: checked against [PR #32](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/32)
head [`506369c`](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/commit/506369c5d3037ce18516983609ca230ce939e34e)
(**Group elevation sources in one toggle and dropdown**), the remote head at
review time. GitHub reported the PR updated November 14, 2026 at 04:42:58 UTC
(November 13 at 11:42:58 p.m. EST). The local HEAD matches that exact revision.

## Confirmed direction

- Add many useful basemap providers/styles through one **Base map** menu, using
  the existing Elevation source dropdown as the interaction reference.
- Use the existing MapLibre renderer. “Tile libraries” means provider adapters
  and styles, rather than installing a separate mapping SDK for each vendor.
- Drop the server-cache/self-hosted tile-package proposal. Fetch provider content
  directly; add no server prefetch, tile storage, cache or quota-avoidance proxy.
- The owner's latest clarification supersedes the earlier requirement to hide
  every tile key: an app-visible map key is acceptable **only when copied-key
  usage cannot incur charges beyond the free allowance**. Exhausting free usage
  is an accepted availability risk. Account credentials remain secret.
- Treat public tile keys as extractable. No encryption or obfuscation can make a
  credential delivered to a user's device impossible to copy.

## Repository and ownership context

The current native map hard-codes OpenFreeMap Liberty in
`mobile/src/components/preserve-map.tsx`. `MapGisProvider` shares session-only
overlay choices between Map and the chooser; the current terrain work adds one
Elevation switch and a source dropdown. The chooser currently disables Done
without a GIS snapshot, and `applyHidden` returns early without that snapshot.
Basemap selection must be independent of those API conditions.

The implementation baseline is PR #32's `gis/04-terrain` head `506369c`, stacked
on `gis/03-pdf-map-layers`. The grouped terrain changes are now committed and
pushed; the earlier plan's uncommitted-work description is superseded. Start
from this reviewed result or a descendant containing it. Recheck the remote PR
head before implementation if PR #32 changes again. Coordinate shared
interfaces with [J6-14](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-14)
(Shriyan Somalinga) and
[J6-19](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-19)
(Theodore Halpern); these are observed owners, not new assignments.

The [Figma chooser](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=32-40)
was inspected earlier in this task. A grouped basemap dropdown extends that
screen and the existing Elevation pattern; it is not an existing Figma frame.
Follow the specification index and UI/disclaimer rules in `docs/README.md` and
`docs/design/ui-spec.md`.

### PR #32 compatibility requirements

The current code, tests and specifications at the pinned head establish:

- `MapGisProvider` owns `hidden`, `terrainSource` and `terrainEnabled`; derived
  hidden IDs expose exactly one available terrain source when enabled. USGS is
  the default, the chosen source survives disabling/refresh, and an unavailable
  selected source falls back to the remaining public source. Extend this state
  without reverting to independent terrain switches.
- `LayerSelectionScreen` groups both API terrain layers into one Elevation
  choice for counts. Keep that grouping, Done/apply, Back/cancel and the
  dropdown's source-limit/similarity explanation. Basemap rows add no GIS switch
  or overlay count. Source-selection changes stay draft until Done.
- With the complete imported dataset, the API has nine layers/131 features;
  the default USGS-visible snapshot has eight layers/102 features and Supplied
  DTM has eight layers/98 features. The chooser has eight GIS switches. Changing
  only the basemap must leave these counts unchanged.
- `visibleTerrainKeys` drives bundled hillshade ImageSources; `terrain.ts`
  validates source/version/hash/placement against local assets and rejects
  unknown terrain kinds. Basemap provider adapters must not bypass this check,
  repurpose reserved terrain IDs or turn terrain assets into remote URLs.
- Preserve the existing relief/band/context/trail/label order, trail/landmark
  hit priority and source attribution. Detailed terrain caveats stay in
  Disclaimers; the existing owner-approved explanation stays in its dropdown.
- Extend `mobile/__tests__/terrain.test.tsx` to exercise basemap changes with
  Elevation off, USGS selected and Supplied DTM selected, including cancelled
  drafts, refresh/source fallback, camera preservation and no duplicate images.
  Retain its rejection tests for stale/missing/version/hash/placement assets.

This was a source/test review, not a rerun of PR #32's application or device
checks. The PR description still contains older independent-switch/both-source
wording and screenshots; use the pinned implementation and updated
`docs/design/ui-spec.md`, `docs/design/user-flows.md` and
`data/cascade-springs-gis/TERRAIN.md` for the current grouped-source behavior.

## Provider inventory and free-plan research

Checked November 13, 2026. Limits can change: recheck the linked official pages
and actual account settings before activation. A credit, tile request, session
and map view are different units; multiple styles share their provider account's
allowance. An API's free allowance alone does not establish a spending cap.

| Provider                 | Proposed choices                                                                          | Published free allowance                                                                                                         | Key and activation decision                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenFreeMap              | Standard/Liberty, Light/Positron, Bright, Dark, Fiord                                     | Public instance advertises no map-view/request limits; commercial use allowed; no SLA                                            | No key. Include after preserve rendering/attribution checks. [Provider](https://openfreemap.org/), [styles](https://openfreemap.org/quick_start/).                                                                                                                                                                                                                                                                                                       |
| USGS National Map        | Aerial, Topographic, Aerial + Topographic, Shaded Relief                                  | Free public services/data; no subscription allowance advertised                                                                  | No key. Include distinct useful choices after coverage/zoom checks. These are contextual basemaps, separate from the preserve's approved GIS. [Basemap inventory](https://www.usgs.gov/faqs/what-are-base-map-services-or-urls-used-national-map), [usage](https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map?qt-news_science_products=0).                                                                         |
| MapTiler Cloud           | Streets, Outdoor, Satellite, Hybrid; add other distinct free catalog styles when verified | Free: 100,000 API requests/month and 5,000 sessions/month; testing/personal/noncommercial eligibility and logo/attribution apply | App-visible public map key is a primary candidate. Free maps suspend when the allowance is exhausted; paid plans charge extra. Require a dedicated Free account with no paid billing linkage. [Pricing](https://www.maptiler.com/cloud/pricing/), [limit behavior](https://docs.maptiler.com/guides/account/sessions-vs-requests/), [terms](https://www.maptiler.com/terms/cloud/).                                                                      |
| Stadia Maps              | Alidade Smooth, Smooth Dark, OSM Bright, Stamen Toner, Stamen Terrain                     | Free: 200,000 credits/month; noncommercial/academic use; standard basemaps only                                                  | App-visible map key is a primary candidate. At credit exhaustion APIs return 429 unless additional usage is opted into. Require Free/no payment method/no additional usage. Satellite is paid and excluded; do not ship trial-only styles. [Pricing](https://stadiamaps.com/pricing/), [limits](https://docs.stadiamaps.com/limits/), [trial/upgrade behavior](https://docs.stadiamaps.com/upgrading-subscription/).                                     |
| Thunderforest            | Outdoors, Landscape, OpenCycleMap, Atlas, Transport Dark                                  | Hobby: 150,000 tile requests/month; advertised no surge charges                                                                  | Secondary candidate. Published terms describe discretionary free service and throttling but do not establish the complete copied-key, hard-stop billing guarantee. Keep disabled until the actual free account and provider evidence establish no paid overage liability. [Pricing](https://www.thunderforest.com/pricing/), [terms](https://www.thunderforest.com/terms/), [styles](https://www.thunderforest.com/maps/).                               |
| Geoapify                 | OSM Bright, Positron, Dark Matter and other distinct catalog styles                       | 3,000 credits/day; a map tile costs 0.25 credits, so up to 12,000 tiles/day if credits are used only for tiles                   | Research candidate, disabled pending a documented no-charge hard cap. Published limits are soft, and terms reserve suspension/overage charges; no-card signup alone is insufficient. [Map pricing](https://www.geoapify.com/map-tiles/), [soft limits](https://www.geoapify.com/free-maps-api/), [terms](https://www.geoapify.com/terms-and-conditions/).                                                                                                |
| ArcGIS Location Platform | Imagery, Streets, Light Gray or other MapLibre-compatible styles                          | Tile-based model: 2 million basemap tiles/month free, then paid usage                                                            | Research candidate, disabled unless the selected account/product has an enforceable zero-spend cap for all key-accessible services. Free allowance is followed by usage charges; a budget alert is insufficient. Verify attribution/authentication and renderer support. [Pricing](https://developers.arcgis.com/pricing/credits/), [styles](https://developers.arcgis.com/documentation/mapping-and-location-services/mapping/basemaps/arcgis-styles/). |
| Jawg                     | Streets, Light, Dark, Terrain where supported                                             | Basic: 25,000 map views/month; one view equals 15 raster/vector tiles or four raster-512 tiles                                   | Research candidate. Confirm native-app eligibility, no-charge cutoff and supported styles before activation; published noncommercial eligibility specifically describes public websites. [Pricing and eligibility](https://www.jawg.io/en/pricing/).                                                                                                                                                                                                     |

Initial target: the nine keyless choices above plus the verified Free-plan
MapTiler and Stadia choices, roughly 18 styles before any additional candidates.
Treat this as an inventory target, not a promise that every source meets local
quality, license or account criteria. Check provider IDs and URLs against the
current catalog instead of deriving endpoint slugs from these display names.
Include every distinct eligible style that passes the checks; do not cut the
catalog to the original five simply to avoid adapter work.

For aerial imagery, inspect preserve acquisition date, alignment and native
detail. USGS ImageryOnly is largely aerial photography, not live satellite
imagery. Its metadata advertises a useful display scale near 1:9,028 despite
listing more tile levels: verify actual tiles before choosing source maxzoom.
Keep the camera's zoom range and overzoom existing raster detail where needed.
[Imagery metadata](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer?f=pjson).

## Zero-charge rule for app-visible keys

This is an account-side guarantee to verify, not a promise the app can enforce
with a local request counter. Someone holding the key can bypass our app.

Before enabling any keyed source, record an activation checklist with date,
provider plan and evidence location. Store evidence without real key values:

1. Use a dedicated Free-only provider account/project, separate from any paid
   account, organization, marketplace subscription or shared paid billing scope.
   Do not attach payment details, credit/invoicing terms or a paid trial.
2. Verify documented provider-side hard rejection/suspension at the free limit.
   Verify no automatic upgrades, additional usage, auto-recharge, top-ups or
   metered charges, including every service the tile key can access.
3. Use a public/read-only map key with the narrowest available permissions.
   It must not manage accounts, billing, subscriptions, datasets or other keys.
   Keep account passwords, OAuth secrets and service/admin tokens out of the app.
   MapTiler explicitly distinguishes public map API keys from secret service
   tokens. [Credential types](https://docs.maptiler.com/guides/developer/credentials/).
4. Apply supported app/domain/API restrictions and per-key limits as additional
   abuse controls. Verify restrictions work on native iOS/Android; web referrer
   restrictions alone may not work for a native renderer. They are not the
   financial guarantee. Do not rotate identities or accounts to evade quotas.
5. Confirm the intended project qualifies for the Free plan beyond a development
   trial. Nonprofit status alone does not prove every vendor's eligibility.
6. Test quota/rejection handling using fixtures, a sandbox or a provider-supported
   low limit. Do not deliberately burn the real free allowance for testing.
7. Repeat this check before release and after account/terms changes. Disable the
   provider before moving its account onto any paid plan. Already-installed apps
   retain copied keys, so revoke their old keys before any billing transition.

Missing evidence means the provider stays disabled, with the no-key sources
available. A screenshot of a billing alert or a best-effort client-side cap does
not meet the rule. No paid subscription, account signup or billing change is
authorized by this planning document.

Public map keys may be supplied through ignored local/build environment
configuration and included in the mobile bundle only after this gate passes.
Do not commit actual values or put them in Jira, screenshots, test fixtures or
logs. Public configuration is visible to the device; it is not secret storage.
The provider account state has not been inspected and no real keys were used
during this planning task.

## One menu and selection behavior

Add one **Base map** card above GIS overlays in Choose GIS Layers. It shows the
currently selected style and an expandable **Choose base map** button, matching
the Elevation dropdown's visual pattern. A basemap is always selected; use no
additional enable switch. Retain Elevation's own independent switch/source menu.

Inside the one expandable menu, use provider headings and single-choice rows:
OpenFreeMap, USGS, MapTiler, Stadia and any subsequently eligible provider. Show
provider and style names together to distinguish similar styles. Support long
lists with the screen's existing scrolling, accessible expanded/checked state,
44-point targets, large text and screen readers. Avoid nested provider menus.
Selecting a row updates the draft and collapses the menu; **Done** applies it.
Do not preview/download every style while opening or scrolling the menu.

- Default remains OpenFreeMap Liberty. Exactly one basemap renders at a time.
- Done applies the basemap and valid overlay draft together. Back, swipe/system
  back or other cancellation discards the draft. Applied choices are session-only;
  restart uses the default. Persistence belongs to the offline work.
- Allow basemap selection and Done when public GIS is unconfigured, loading,
  empty or failed. Apply only valid overlay edits for the current snapshot;
  invalidated GIS drafts must not erase a valid basemap draft.
- Basemap changes do not enter overlay counts or pillar classifications, fetch
  GIS again, request GPS permission, refit bounds or reset the camera. Preserve
  existing blur/resume behavior for an enabled GPS session.
- Ship only configured, eligible choices as selectable. Missing-key and pending
  providers remain in developer documentation rather than presenting signup or
  payment setup to visitors. Keep the menu usable without an API connection.
- On failure/quota exhaustion, stop retries and show a transient status with
  **Use Standard map** and **Retry**. Switching to Standard is an explicit
  action; preserve all overlay/GPS/camera state. Do not cycle through paid/keyed
  alternatives automatically. Reset failure state on a deliberate new attempt.
- Keep legal attribution/logo visible and accessible above the dock, including
  provider-specific branding. Standing source/date/accuracy caveats go in the
  shared Disclaimers source per the current UI specification. Provider menus
  show names and operational availability, rather than new billing warnings.

## Proposed implementation

### Registry and configuration

Create a small typed `mobile/src/data/basemaps.ts` registry with stable
provider/style IDs, names, style URL or constructed raster style, attribution,
branding, bounds, native zoom range, tile size and glyph compatibility metadata.
Keep provider plan/billing evidence references in developer documentation. A
style is eligible only when implemented, configured and approved for this use.
Never accept arbitrary user-supplied tile URLs or keys through the map UI.

Separate public map-key configuration from administrative secrets; use ignored
local/build configuration with placeholder examples. Reuse Expo SDK 57/MapLibre
11 and existing dependencies. Share provider usage across all its style entries;
changing style or using another key does not replenish the provider quota.

### Shared chooser state

Extend `mobile/src/hooks/map-gis-context.tsx` with the selected basemap ID and a
single apply operation. Keep selection independent of API snapshot availability.
In `mobile/src/components/layer-selection-screen.tsx`, manage the basemap draft
separately from snapshot-scoped hidden layers/terrain choice, preserving the
existing grouped Elevation behavior and stale-layer filtering.

### Native map rendering

Replace `MAP_STYLE` in `mobile/src/components/preserve-map.tsx` with the selected
registry entry, while keeping the native Map mounted. Do not change its React
key for style changes. Audit readiness, the 20-second timeout, retry remounting
and fitted-snapshot logic so style loading cannot trigger an unwanted camera
reset or stale completion after rapid switches. Preserve the camera through
an unavoidable explicit retry remount as well.

Reattach GIS/image sources correctly after native style reload. Keep basemap
content below preserve relief, polygons, trails, labels and device position.
Use the existing contrasting trail casing/label halos and verify both terrain
sources over light, dark and aerial content. Provider-drawn roads/trails are
context and do not enter preserve feature hit-testing or the trail legend.

For raster styles, provide glyph support for existing Noto Sans text; a raster
background alone does not supply the glyph endpoint used by our overlay labels.
Validate font-stack availability for each vector style or select an equivalent
verified stack. USGS uses 256-pixel Web Mercator tiles and ArcGIS URL order
`/tile/{z}/{y}/{x}`. Verify high-zoom availability and use tested source limits.
Provider-specific adapters must preserve their attribution and permitted URLs.

No new backend routes, database migration, object-storage bucket or tile relay
is expected. No-key and accepted public-key requests go directly to providers.
The existing web map remains a native-build information screen for this PR.

### Failure and quota handling

Native map events may not identify individual HTTP failures consistently on
both platforms. Prototype actual provider 401/403/429 behavior and blank-tile
failure on the pinned SDK before finalizing detection. Generic map unavailable
with a usable Standard fallback is required even if a precise quota message
cannot be established. Do not claim quota detection based solely on style JSON
loading. Bound timeouts/retries and keep basemap/GIS/GPS errors distinct.

Do not fetch all candidate styles, glyphs or thumbnails to measure availability.
Cancel obsolete app-owned requests; verify native source replacement stops
inactive-provider tile traffic. Retain provider HTTP caching behavior on the
device only as permitted; this adds no downloadable/offline package guarantee.

## Delivery steps

1. Verify free-plan billing/eligibility evidence and style catalogs; create an
   activation record with missing account checks explicit. Review imagery and
   label rendering over the preserve at normal and close zooms.
2. Add the typed registry/provider adapters, configuration examples and tests.
3. Add shared basemap state and the single grouped dropdown, preserving terrain,
   API-error independence and Done/Back behavior.
4. Integrate native style switching, source/label/attribution handling and bounded
   failure recovery. Load only the selected provider.
5. Update architecture, UI/user-flow, key-handling, provider setup and offline
   boundary documentation. Record only confirmed production choices in D-05;
   do not silently resolve remaining data/hosting/offline decisions.
6. Run repository checks and native acceptance; capture screenshots for a draft
   PR linked to J6-68. Keep implementation commits focused and reviewable.

## Verification and acceptance

- Registry tests: unique/stable IDs, safe default, supported URLs, raster axis
  ordering/tile sizes, required attribution/branding and missing-key filtering.
- Chooser/context tests: every configured provider group, one selection,
  Done/Back/reopen, catalogue replacement, absent/failed GIS, independent terrain
  source/visibility, session reset and valid baseline fallback.
- Map regression tests: rapid changes, overlays restored once after reload,
  camera unchanged, no new GIS/GPS request, glyph/style failures, timeout,
  quota/auth rejection and no automatic retry/provider loop. Mock quota failures
  without making live requests that consume the allowance.
- Configuration checks: only accepted public map keys in export outputs; no
  service/admin token, payment credential or account-management capability.
  Record provider-side zero-charge evidence separately from app test results.
- Run `pnpm verify` and `git diff --check` with Node 24.21.0 and pnpm 10.26.2.
  Add meaningful regression coverage rather than tests duplicating constants.
- Native iOS and supported Android: visually inspect every enabled style,
  attribution/logo, feature taps and label contrast; exercise pan/zoom, both
  elevation sources, all overlays off, location denial, enabled GPS/recenter,
  slow/no network, quota fixtures, retry, cancellation and accessibility. Bundle
  export, native compilation and device smoke results are separate evidence.
- No location coordinates or full credential-bearing tile URLs in app logs or
  diagnostic screenshots. Direct providers receive tile requests identifying the
  viewed area; switching does not add a separate GPS telemetry request.

This planning task changes documents only. Application checks, native provider
quality and account-specific billing settings remain unverified until execution.

## Related work and boundaries

[J6-35](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-35),
[J6-57](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-57) and
[J6-58](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-58) retain the offline
prototype, durable cache and download/storage-management scope. This ticket
neither adds a server cache nor claims complete offline map coverage.

The remaining implementation inputs are actual Free-only provider accounts and
eligible public map keys, preserve-specific visual checks, current style IDs,
and production-use eligibility. Pending providers remain documented candidates.
Proceed with verified sources while those inputs are unavailable; never replace
the zero-charge requirement with a billing alert or an exposed paid-plan key.
