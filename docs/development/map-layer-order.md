# Native map layer ordering

The owner requested a natural rendering order on top of
[signal PR #38](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/38).
Branch `gis/06-layer-order` changes display order and overlapping-hit priority;
it does not change source geometry, layer visibility defaults, the API or GPS.

## Bottom to top

| Stage                   | Content                                                       |
| ----------------------- | ------------------------------------------------------------- |
| Basemap                 | Existing OpenFreeMap style                                    |
| Ground relief           | Supplied DTM relief, then USGS relief when both are enabled   |
| Ground areas            | Elevation bands, preserve fill, natural-area fill             |
| Physical context        | Elevation contours, water, roads, buildings and context lines |
| Preserve edge           | Boundary outline, separate from its low-level fill            |
| Analytical observations | Cell-signal sample dots                                       |
| Routes                  | Trail casing, named strokes and unnamed connections           |
| Places                  | Landmark and source-annotation markers                        |
| Text                    | Elevation labels, trail names, then landmark names            |
| Device                  | Current device position, in its separate source               |

This clarifies the older “trails always on top” wording in J6-19: trails stay
above ground/context/analytical overlays, while place markers and labels remain
legible above route strokes. Crowded feature hits prefer landmarks, then trails,
then samples. Specific context/elevation hits retain their existing priorities.
The device position is excluded from public-feature selection.

## Implementation and verification

`mobile/src/data/map-layer-order.ts` owns the bottom-to-top vector order and
native `afterId`/`beforeId` props. The public GeoJSON source and its style layers
remain mounted with an empty collection when GIS is loading, unavailable or all
hidden. This provides stable targets without inventing displayed features.
Two invisible, always-false fill layers reserve independent terrain slots;
rasters target those slots rather than another conditionally mounted image.
The source/targets mount before image sources, and device position explicitly
targets the top GIS label layer. Catalog sorting and native source arrival order
therefore do not select the paint order.

The existing paint values, classification filters, source identities, chooser,
legend and camera controls are retained. No new native dependency/build is needed.
Visibility remains session-only, and persistent offline availability is unchanged.

Regression checks inspect rendered native props, semantic ordering constraints,
both terrain hide/show orders, all-hidden/empty GIS, camera preservation, device
position over unavailable GIS, and crowded landmark/trail/sample selection.
Run `pnpm verify` from the workspace root. Native review uses iOS 26 as the
primary target; JavaScript exports do not establish native or Android execution.

## Completion record

Verified on the existing `Cascade iOS 26` iPhone 17 / iOS 26.3 client through
Metro 8088 and Worker 8792. All ten layers / 808 features rendered with location
off, intact landmark markers above route casing and analytical dots below routes.
Disabling both terrain sources changed 808→746; restoring USGS then supplied
changed 746→779→808 without moving the zoomed camera or covering vector features.
See the [iOS 26 screenshot](../images/ios26-natural-layer-order.png).

`pnpm verify` passed (122 backend unit tests, 122 mobile tests, formatting, lint,
types and both platform JavaScript exports). After the native bridge rejected a
numeric constant filter, the anchors were changed to a supported contradictory
property filter; final mobile lint/types, all 122 tests and both exports passed.
`git diff --check` passed. Existing API/database contracts and source bytes are
unchanged; no fresh database import or native compilation was required.

Android native execution, native GPS-over-all-hidden, crowded feature tapping,
manual permission denial and retry/style-reload device paths remain unverified.
Automated checks cover these ordering/state cases with native mocks; older iOS
coordinate automation still reports `noWindowsAvailable`. This does not add
durable offline storage or change access restrictions.
