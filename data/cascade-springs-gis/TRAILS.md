# Supplied trails (PR 2)

**Current PR 3 selection:** the [PDF map slice](PDF-MAP.md) supersedes this
record’s eight-landmark/approximate-boundary handoff. Combined source import now
publishes seven layers/69 features. Trail-only behavior remains unchanged.

`cascade-map-trails` now uses 36 supplied shapefile segments instead of the ten
approximate My Maps sections. This slice is stacked on
[PR 1 #29](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/29).
The original files and [manifest](manifest.json) are unchanged.
Tracking: [J6-22](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-22),
[J6-13](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-13),
[J6-20](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-20),
[J6-23](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-23),
[J6-26](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-26).

## Reproduce and import

From the repository root, use the [pinned GIS environment](README.md#reproduce-verification-and-inspection):

```sh
uv run --locked --project tools/gis python tools/gis/convert_trails.py
pnpm exec prettier --write data/cascade-springs-gis/trails.geojson
uv run --locked --project tools/gis python tools/gis/convert_trails.py --check
uv run --locked --project tools/gis python -m unittest discover -s tools/gis -p 'test_*.py'
pnpm --dir backend db:import:source
pnpm --dir backend db:import:trails
```

The converter verifies the original manifest, extracts into ignored
`.work/gis-data/extracted/`, then writes [trails.geojson](trails.geojson) through a
temporary sibling file and rename. `--check` compares parsed content without
rewriting it. No new GIS dependency, network data fetch, proprietary software,
physical table, migration, or native dependency is needed.

After migrations, `db:import:source` imports **36 supplied segments plus eight
unchanged My Maps landmarks** atomically. The legacy KML remains validated
archive input, but its route is never selected for publication.
`db:import:trails` replaces only trails and preserves existing landmark metadata
and features. On a new database it creates only the trail layer; use the combined
source command for landmarks. Both commands share advisory lock **(6342, 2)**.
Repeated or concurrent runs cannot restore approximate routes. Legacy
`data:convert` regenerates the archived KML GeoJSON only.

Check the intended database first: `CASCADE_DB_PORT` changes the default local
port 55432; `DATABASE_URL` overrides the derived URL. `test:fresh` creates and
removes only its own disposable loopback database. The separate
`db:import:boundary` keeps the approximate boundary until PR 3.

## Data and route-family contract

All 36 single-part segments and 1,901 vertices retain their source traversal
order. EPSG:3857 transforms to WGS84 longitude/latitude without snapping,
simplification or merging. The API now serializes geometry with up to 15 decimal
places, preserving this snapshot through its PostGIS/API round trip. New names,
multipart geometry or positions outside the conservative review bounds fail
conversion for review rather than dropping parts or guessing.

Converted positions use 12 decimal degrees. `--check` tolerates at most
`2e-12` degrees of platform-specific projection rounding (submicrometre), while
requiring exact IDs, attributes, order and metadata. Every original vertex is
retained; inverse-projection tests compare to the source within a micrometre.
This numeric representation does not imply surveyed accuracy.

Feature IDs are `csnp-official-trail-<canonical lowercase GlobalID UUID>`.
Source GlobalID/SEGMENT_ID strings remain exact; missing/duplicate IDs fail.
Array order, names and reused `TRL_ID` values never determine feature identity.
Layer ID remains **`cascade-map-trails`**, `pillar` null, `isDemo` false.
`cascade-map-landmarks` retains all eight source identities. Source-only import
has two layers/44 features; with the retained boundary the map has three/45.

[trail-contract.json](trail-contract.json) shares mapping and raw-field rules
between converter and importer. Source labels remain distinct when families group.

| Source name            | Segments | App family              |
| ---------------------- | -------: | ----------------------- |
| Turkeyfoot Creek Trail |        6 | `turkeyfoot-utoy-creek` |
| South Utoy Creek Trail |        5 | `turkeyfoot-utoy-creek` |
| West Trail             |        6 | `west`                  |
| White Oak Trail        |        5 | `white-oak`             |
| Battle Ridge Trail     |        5 | `battle-ridge`          |
| Gateway Trail          |        3 | `gateway`               |
| Terrace Trail          |        2 | `terrace`               |
| Bigleaf Magnolia Trail |        1 | `bigleaf-magnolia`      |
| Springs Trail          |        1 | `springs`               |
| Big Beech Spur         |        1 | `spur`                  |
| Blank                  |        1 | Absent; unassigned      |

The unnamed segment uses “Unnamed trail segment,” no guessed family and the
existing dashed-gray styling. Nine named families plus the unnamed entry appear
in the trail key. The display palette is unchanged, including Gateway's dark
casing and West's red token alongside raw source `ORAN`. All source color codes
remain in `source_properties.TrailColor`.

[INGESTION.md](INGESTION.md) defines normalized/raw properties. Only Big Beech
Spur supplies difficulty (`easy`); the other 35 values remain absent. Three zero
widths remain absent from normalized data; 33 positive `average_width_in` values
retain **inches**. Surface, roughness and 14 notes are preserved. Roughness never
implies difficulty. Public details allowlist roughness, source segment and width
with its unit. Personnel and workstation fields are excluded.

`length_m` is a WGS84 ellipsoidal per-segment sum using `pyproj.Geod`, rounded to
millimetres with `derived_values` method/tool provenance. Approximately 4,098.856 m
is a segment sum, not an itinerary or surveyed mileage. Zero source `ELEV_GAIN`
does not become measured ascent. Source hash/CRS and mapping version travel with
features; tool versions and transform method are in collection `conversion` metadata.

Literal `PublishTra: TRUE` is eligible; `FALSE` is excluded before public output;
unknown/missing flags fail conversion. All 36 current rows are true. Runtime
validation rejects private flags, extra properties, inconsistent raw/normalized
values, duplicates, invalid positions and invented attributes. A converted subset
removes stale previously public rows on successful import. Empty conversion
requires review rather than silently publishing an empty placeholder.

The shared replacement helper now receives one explicit collection per layer
and rejects duplicate layer/feature assignments and unsupported geometry. It
transactionally replaces only owned layers, removes old approximate/stale IDs,
preserves unrelated layers and rolls back the complete replacement on error.
Fresh-DB setup and CI replay both current and legacy import entry points.

## Verification and limits

Verified on macOS, Node 24.21.0, pnpm 10.26.2, Python 3.12.13, locked GIS tools
and loopback PostGIS on 55435:

- Fourteen Python tests plus conversion `--check` passed. Inverse projection
  checks every original vertex; publication, missing values and identity failures
  are covered.
- Linux Docker source/conversion tests also passed with Python 3.12.12 and the
  same locked GIS dependency versions. The macOS environment uses pinned Python
  3.12.13; the available Linux image needed an explicit installed-interpreter
  override because its older uv could not download that patch release.
- Disposable `test:fresh`: **96 backend tests** passed, repeated migrations/seeds,
  import replay, mixed concurrent writers, stale cleanup, geometry and combined
  trail/landmark rollback, bbox/public access, and real Worker HTTP/failure checks.
- Backend TypeScript and Worker dry-run builds passed; no deployment ran.
- `pnpm verify` passed formatting, lint/typecheck, 76 backend unit tests
  (20 DB cases run separately above), 97 mobile tests and both iOS/Android
  JavaScript exports. Markdown rendering/file links and `git diff --check` passed.
- **97 mobile tests** passed, including the real supplied snapshot's route
  families, details/units, unnamed/Gateway styling, hiding/restoring features and
  the existing camera, permission-denial and failure/retry tests.
- Existing iPhone 16 Plus / iOS 18.6 client on Metro 8082 / Worker 8788 showed
  45 features with location off. Zoom revealed source labels. Hiding trails left
  nine features and removed the trail key; reenabling restored 45 features
  without refitting the zoomed camera. [Overview](../../docs/images/ios-supplied-trails.png)
  and [restored close-zoom labels](../../docs/images/ios-supplied-trail-labels.png).

No native dependency/configuration changed and no new native compilation ran.
Android native execution, manual permission denial, native feature-sheet tapping,
every label at every zoom, field alignment and persistent offline restart/retry
remain unverified. Coordinate map taps returned `noWindowsAvailable` from the
computer-use service; native accessibility controls worked. Selection and new
field formatting are covered by automated tests. For the native check, the local
development database was updated through the combined source importer; existing
Worker/Metro services were reused and left running.

## PR 3 handoff

Start from [PR 2 #30](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/30),
branch `gis/02-official-trails`; implementation baseline is commit `e687b9c`.
Fetch and inspect its current head before creating `gis/03-pdf-map-layers`.
If the stack has merged, use the current parent containing PR 2's changes;
follow the [stack/restacking rules](../../docs/tasks/gis-data-integration-plan.md#2-pr-stack-and-ownership-boundaries)
instead of assuming original commit hashes survived a squash merge. Do not
rewrite another contributor's branch or discard a dirty working tree.

Preserve the 36 supplied trail IDs, `cascade-map-trails`, nullable pillars,
source/derived separation and coordinate precision contract. Source-only import
has 44 features; the current local map has 45 with the separate guessed boundary.
New PDF counts must describe reconciled geographic features, not drawing paths.

### Integration traps to resolve before publishing PDF layers

| Area                             | Current code and required follow-through                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy landmark writer           | [source-map.ts](../../backend/src/db/source-map.ts) still filters the archived My Maps points and requires exactly eight. After PDF reconciliation, change the selected source policy here too; otherwise `db:import:source` will restore old landmarks. Update [its tests](../../backend/test/source-map.test.ts), CLI messages, fresh-DB setup and Worker counts together.                                                                             |
| Legacy boundary writer and locks | [boundary-map.ts](../../backend/src/db/boundary-map.ts) still imports the guessed polygon under lock `(6342, 3)`. Source/trail writers use `(6342, 2)`. Rewire legacy commands to the selected data or fail clearly; shared affected writers must serialize. A combined PDF replacement needs a consistent lock policy/order across boundary and landmark ownership, not a new independent lock. Test mixed concurrent legacy/new commands and rollback. |
| Mixed geometry within a layer    | [gis-import.ts](../../backend/src/db/gis-import.ts) now takes explicit `{ layer, collection }` replacements, but each `ImportLayerSpec.geometryType` still accepts only one exact geometry type. Deliberately extend validation if a logical layer contains Polygon/MultiPolygon or LineString/MultiLineString; do not drop multipart features or create duplicate logical layers just to satisfy this helper. Preserve holes and disconnected parts.    |
| Trail key and line styling       | [trail-presentation.ts](../../mobile/src/data/trail-presentation.ts) currently decorates every line and adds unknown lines to “Other trails.” Filter explicit road/water context out of trail presentation, names, casing and legend. Preserve the existing generic/demo trail fallback and test context-only/all-hidden snapshots.                                                                                                                      |
| Polygon and point styling        | [preserve-map.tsx](../../mobile/src/components/preserve-map.tsx) currently gives all polygons boundary styling and all points landmark styling. Add explicit context-kind styling/order so water, natural areas and buildings remain distinct, with trails legible above them. Preserve selection, switches and camera behavior.                                                                                                                         |
| Building classification          | [trail-network.ts](../../backend/src/modules/gis/trail-network.ts) has no building feature kind yet. Extend the logical contract and its validation/tests rather than calling buildings landmarks or natural areas. Generic physical GIS tables remain sufficient.                                                                                                                                                                                       |

### Extraction evidence and completion boundary

Use the committed `sources/CSNP Trail Map.pdf` and
[inspection.json](inspection.json) for the existing `/VP` anchors, WKT and content
groups. [inspect_sources.py](../../tools/gis/inspect_sources.py) produces the
full-page `.work/gis-data/map-preview.png`; it does **not** extract PDF geographic
features or generate an alignment overlay. No PDF converter, registration controls,
reconciled landmark table or final context counts have been committed yet.
Create reusable extraction/overlay scripts and durable review evidence for PR 3;
another agent must not need Downloads, `/tmp`, or this checkout's ignored caches.

The [PR 3 scope and PDF inventory](../../docs/tasks/gis-data-integration-plan.md)
already describe latitude/longitude anchor order, differing Y origins, repeated
water passes, legend exclusions and 15 map symbols. Use the PDF skill for visual
review. Align against supplied centerlines; do not replace them with PDF strokes.

Keep PDF difficulty evidence separate until source precedence is confirmed:
Springs conflicts with the older sign, and South Utoy's uphill guidance is
conditional. Until that decision, leave the other 35 segment difficulties absent. Licensing,
surveyed alignment, pillars, safety tolerances and raster/signal registration also
remain open under D-05. Terrain and signal integration belong to later PRs.

For acceptance, carry forward the native limits above: Android execution,
manual permission denial and native feature-sheet tapping remain unverified.
Existing screenshots establish rendering/toggles with location off, not those
other paths. Recheck local ports/database overrides before reusing services;
the earlier running Worker 8788, Metro 8082 and PostGIS 55435 are session evidence,
not prerequisites. HTTP freshness and session-only snapshots still do not provide
durable offline restart/retry.
