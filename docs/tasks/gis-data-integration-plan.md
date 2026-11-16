# Supplied GIS data integration: stacked PR plan

Prepared November 11, 2026. Status: **PRs 1–4 implemented; PR 5 planned**.
PRs 2–3 import supplied trails and PDF geographic context; the original source-preservation slice
did not import datasets. This document is the handoff for
fresh agents implementing the stack; it is not evidence that the proposed
behavior or verification is already complete.

The project owner requested integration of all data in
`/Users/theohalpern/Downloads/GIS-Data`, explicitly allowing creative extraction,
then requested a data review and this plan before implementation. Use five
stacked draft PRs. Preserve source evidence and distinguish direct GIS data from
derived or approximately aligned content throughout ingestion and presentation.

## 1. Start here for every fresh agent

1. Read repository [AGENTS.md](../../AGENTS.md), run `git status --short`, and
   inspect the intended parent branch. Preserve unrelated edits. The owner
   explicitly included the existing `AGENTS.md` engineering-ownership addition
   in PR 1.
2. Read the [specification index](../README.md), [architecture](../architecture.md),
   [data model](../data-model.md), [API](../api.md), [security](../security.md),
   [offline GIS](../offline-gis.md), [UI specification](../design/ui-spec.md),
   [user flows](../design/user-flows.md), and [decisions](../decisions.md).
   For mobile edits also read [mobile/AGENTS.md](../../mobile/AGENTS.md).
3. Read this plan, your PR section, and the preceding PR's final handoff. Check
   actual code rather than assuming the historical plans describe current code.
4. Consult the relevant Jira items for current scope/ownership and Figma for UI
   changes. Do not broadly repeat the source investigation or search unrelated
   systems. Follow focused documentation when a library/API requires it.
5. Outline your implementation, affected contracts, and checks before editing.
   Implement only the assigned slice, including its tests and documentation.

Use the pinned Node and pnpm versions from `.nvmrc` and root `package.json`
(24.21.0 and 10.26.2 at inspection). Keep one root pnpm lockfile. Extraction
dependencies belong in development tooling, not the mobile runtime. No new
physical GIS tables are expected: D-12 already selects generic GIS tables.

### Reusable scripts and working files

The project owner prefers reusable, maintainable scripts over one-off commands
for repeatable work. Commit extraction, conversion, validation, and diagnostic
overlay generation as named scripts with documented inputs, outputs, and useful
failure messages. Support reruns and fixes without reconstructing inline shell
or Python from conversation history. Keep narrow exploratory commands lightweight;
do not build a general framework for a single inspection.

Use a documented, repository-local working directory (for example,
`.work/gis-data/`, with an appropriate ignore rule) for regenerable intermediates.
Keep source artifacts, final derived datasets, registration controls, and review
evidence in durable, documented locations as specified by each PR. Do not put
handoff dependencies or work that should survive interruption in `/tmp`. Reserve
system temporary directories for truly ephemeral files, such as a disposable
Markdown-render preview or a library scratch file; no subsequent task should
depend on their survival. Add cleanup behavior only for outputs owned by the tool.

## 2. PR stack and ownership boundaries

Use a linear stack so each agent has one explicit parent and each PR diff covers
only its own change. Names below are proposed branch names, not existing branches.

| Order | Proposed branch            | PR title                                                | Base           |
| ----- | -------------------------- | ------------------------------------------------------- | -------------- |
| 1     | `gis/01-source-foundation` | Preserve supplied GIS sources and ingestion contracts   | Current `main` |
| 2     | `gis/02-official-trails`   | Replace approximate trails with supplied trail segments | PR 1 branch    |
| 3     | `gis/03-pdf-map-layers`    | Extract and integrate georeferenced map layers          | PR 2 branch    |
| 4     | `gis/04-terrain`           | Integrate elevation and aligned hillshade               | PR 3 branch    |
| 5     | `gis/05-cell-signal`       | Recover approximate cell-signal observations            | PR 4 branch    |

Create new PRs as drafts, targeting their immediate parent branch. Each body
links its parent and this plan, the relevant J6 issues, changed behavior, checks,
remaining uncertainties, and UI screenshots where applicable. Tests ship with
the behavior they verify; there is no separate final testing PR.

Merge from the bottom of the stack upward. After a parent lands, restack the
remaining branches onto the resulting commits, retarget the next PR, and inspect
its diff for accidentally included ancestor changes. Account for squash merges;
do not assume ancestor commit hashes survived. Do not rewrite another agent's
active branch or force-push without coordinating ownership. Keep small rebase
fixes in the existing PR; substantial scope changes should return it to draft.

PRs 4 and 5 are logically independent after PR 3. If a terrain decision blocks
PR 4, PR 5 can be deliberately rebased onto PR 3 and its dependency updated;
uncertain raster work need not block the vector-data improvements.

## 3. Source inventory already inspected

Original folder:

```text
/Users/theohalpern/Downloads/GIS-Data/
  CSNP_GISfiles.zip
  CSNP Trail Map.pdf
  Cell Signal Strength.png
  CSNP/
    OfficialTrailsCSNP.{shp,shx,dbf,prj,cpg,sbn,sbx,shp.xml}
    HillshadeCSNP.png
    csnp_dtm_2015/*.adf
    info/*
```

All 20 files in the ZIP were compared with the extracted directory and were
byte-for-byte identical. The ZIP is about 20.4 MB; its contents are about 33.3 MB.
The two loose PDF/signal files are additional inputs. Do not commit both the ZIP
and its complete extracted duplicate. Preserve the original inputs unchanged;
compute hashes in PR 1 rather than inventing hashes from this plan. Future agents
must not depend on this user's Downloads directory once the source PR lands.

### Official trails

- Shapefile export metadata: April 9, 2026; CRS **EPSG:3857**, confirmed by both
  `.prj` and XML metadata. Reproject to longitude/latitude, SRID 4326.
- **36 single-part polylines, 1,901 vertices**. Geometry-derived geodesic total
  length is approximately **4,098.86 m**; this is a sum of segments, not a named
  hiking itinerary or surveyed mileage.
- Approximate WGS84 bounds: west `-84.4832749214`, south `33.7152277945`,
  east `-84.4755936870`, north `33.7197267975`.

| Source `TRL_NM`        | Segment count |
| ---------------------- | ------------: |
| Turkeyfoot Creek Trail |             6 |
| West Trail             |             6 |
| White Oak Trail        |             5 |
| Battle Ridge Trail     |             5 |
| South Utoy Creek Trail |             5 |
| Gateway Trail          |             3 |
| Terrace Trail          |             2 |
| Bigleaf Magnolia Trail |             1 |
| Springs Trail          |             1 |
| Big Beech Spur         |             1 |
| Blank name             |             1 |

Useful fields: `TRL_NM`, `TrailColor`, `AVG_WIDTH`, `PARK_ID`, `TRL_ID`,
`SEGMENT_ID`, `GlobalID`, `SURFACE`, `ROUGHNESS`, `NOTES`, `Difficulty`,
`PublishTra`, and source length/grade/date fields. All 36 `PublishTra` values are
`TRUE`; the XML aliases this field as “Show Trail on Public Map?”. Preserve the
flag and validate it; future non-public rows must not leak into public imports.

- `SEGMENT_ID` and `GlobalID` identify segments. `TRL_ID` is not a reliable
  named-route grouping: Bigleaf Magnolia and some White Oak segments reuse the
  Springs ID; other named trails also share IDs. Preserve exact source IDs and
  names separately from any normalized app route/color family.
- Surfaces: 29 Bare Soil, 4 Asphalt, 2 Organic Litter, 1 Concrete.
- Roughness: 26 Intermediate, 5 Rough, 5 Smooth. Do not equate roughness with
  difficulty.
- `AVG_WIDTH` is mean tread width in **inches**, per the XML export field alias;
  33 segments have nonzero values. Three zero values need missing-value handling.
- Fourteen segments have notes about boardwalks, crossings, erosion, paving,
  drainage, or other conditions. These are source observations, not live alerts.
- Only Big Beech Spur has `Difficulty: Easy`, nonzero `GRADE`, and nonzero
  `LENGTH_MI`. The other 35 difficulty values are blank. `ELEV_GAIN`,
  `AvgSegment`, and `Shape__L_1` are zero throughout; `USE_LEVEL` is blank.
  Do not publish placeholders as established measurements.
- Source color codes include BLUE, TGRE, PURP, WHIT, GOLD, AQUA, MAG, ORAN, BLAC.
  West Trail is ORAN; our existing mobile token is red. Keep source values even
  if the display palette initially remains unchanged.

### Georeferenced PDF

`CSNP Trail Map.pdf` is a one-page PDF created by ArcGIS Pro on April 14, 2026,
with a 1,584 by 2,448 point page. It contains optional-content groups and vector
drawing commands, plus raster landmark icons and terrain imagery. It is not a
flattened scan, so start with embedded georeferencing and paths instead of OCR
or manual tracing.

Named content includes `Park Boundaries`, `Natural Areas`, `Bodies of Water`,
`Roads`, `Buildings`, `Trails`, `Points of Interest`, and labels. Inspection found
one boundary drawing, five natural-area drawings, 32 road drawings, four building
drawings, and duplicated water drawing passes. **Drawing counts are not final
GIS feature counts**: paths may contain multiple rings, holes, or repeated strokes.

Georeferencing evidence from the page's `/VP` entry:

```text
/BBox: [0.000000002, 281.286115, 1584, 1931.2693]
/Measure /Subtype: /GEO
/LPTS: [0, 0, 0, 1, 1, 1, 1, 0]
/GPTS: [33.71163, -84.48437,
        33.72051, -84.48437,
        33.72051, -84.47412,
        33.71163, -84.47412]
```

The geographic pairs here are **latitude then longitude**. PDF page coordinates
and PyMuPDF drawing coordinates have different vertical origins. Read the
embedded projected WKT, handle the coordinate spaces explicitly, and verify
registration against the shapefile; do not blindly interpolate latitude as if it
were projected northing. Rounded geographic anchors limit registration precision.

The map shows 15 landmark symbols: one parking, one bridge, one picnic area,
two outdoor classrooms, three historical sites, one cultural feature, three rock
outcrops, one specimen tree, one wildlife-viewing area, and one waterfall.
Fourteen symbols are raster placements; the bridge is composed of vector pieces.
Named labels include Bailey Art Plaza, Boilerhouse and Greenhouse Ruins, Quarry,
Old Building, and Frog Pond / Spring. Symbols have cartographic size and potential
displacement; their recovered anchor is not automatically a surveyed point.

Important extraction traps:

- The same icon images appear in the legend. Legends overlap the geographic
  viewport, so a viewport-only filter will not exclude every legend symbol.
  Respect content groups and inspect a diagnostic overlay.
- Preserve polygon holes and disconnected parts. Deduplicate fill/outline and
  repeated water passes; do not count each paint command as a new feature.
- Clip geographic content appropriately and exclude decorative page furniture.
  Flatten curves only with a documented error tolerance.
- PDF trail paths duplicate the shapefile's subject matter. Prefer the
  shapefile for trail geometry; use the PDF as context and reconciliation evidence.
- The PDF labels Springs Trail **Easy**, while the earlier sign transcription in
  this repository says Moderate. Turkeyfoot/Utoy is Easy with an uphill exception
  to Difficult on South Utoy toward Battle Ridge. Do not flatten that condition
  into a universal difficulty default.

### Elevation and hillshade

`csnp_dtm_2015` is a readable Esri Arc/Info binary grid (GDAL AIG driver):

- 3,369 columns by 2,178 rows; 7,337,682 valid float32 cells in the inspected grid.
- Approximately 2-foot horizontal cell spacing; elevation range **809.32–1,037.27
  feet**. Source vertical reference says NAVD88 height in US survey feet.
- Horizontal projection is Transverse Mercator, GRS80 ellipsoid, central meridian
  `-84°10′`, latitude of origin `30°`, scale `0.9999`, false easting `700000 m`,
  with grid coordinates in US survey feet. The horizontal datum is not fully
  identified. Do not silently assign an EPSG datum or certify a ballpark transform.
- Filename suggests 2015; no independent acquisition-date evidence was found.
- The `info` directory is supporting Esri data, not another map layer. Keep the
  original grid/supporting files together when extracting the archive.

`HillshadeCSNP.png` is 1,156 by 776 pixels with colored relief and a preserve
outline. Its PNG metadata has color/DPI information, but no geographic transform;
no world file was supplied. Do not stretch it to the DTM bounds merely because
both depict the preserve. Registration against shared boundary/terrain evidence
needs explicit controls and a diagnostic overlay.

### Cell-signal screenshot

`Cell Signal Strength.png` is 932 by 662 pixels, without embedded georeferencing.
It contains colored point observations and landmark annotations. Legend classes:
`< -120`, `-120–-117`, `-117–-113`, `-113–-108`, `> -108`.

There are no raw coordinates, exact readings, explicit measurement units,
carrier, device, or survey date. Do not assert dBm, interpolate a precise coverage
surface, or infer current connectivity from the image. Recoverable point counts
have not been established. Marker overlap/occlusion limits extraction completeness.

## 4. Existing implementation and files to use

| Location                                                                                                                                                       | What matters for this stack                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [GIS schema](../../backend/src/db/schema.ts)                                                                                                                   | Generic layers/features; text IDs, JSON properties, valid nonempty SRID 4326 geometry, spatial index.                                          |
| [Shared public types](../../backend/src/modules/gis/types.ts)                                                                                                  | Catalog and GeoJSON contract; keep mobile imports type-only.                                                                                   |
| [Trail-network properties](../../backend/src/modules/gis/trail-network.ts)                                                                                     | Existing feature families and optional route attributes; extend deliberately if needed.                                                        |
| [Shared importer](../../backend/src/db/gis-import.ts)                                                                                                          | `replaceLayers` transaction and advisory locks; currently selects features by geometry type alone.                                             |
| [Legacy source importer](../../backend/src/db/source-map.ts) and [section mapping](../../backend/src/db/source-map-trails.ts)                                  | `cascade-map-trails`: ten approximate sections; `cascade-map-landmarks`: eight original My Maps points.                                        |
| [Boundary importer](../../backend/src/db/boundary-map.ts)                                                                                                      | `cascade-map-boundary`: hand-drawn provisional polygon; separate from synthetic demo data.                                                     |
| [Demo seed](../../backend/src/db/demo-seed.ts)                                                                                                                 | Explicit synthetic `demo-boundaries` layer; preserve its test role and keep source-only setup separate.                                        |
| [Layers repository](../../backend/src/modules/gis/layers.repo.ts)                                                                                              | Public-only reads and `ST_Intersects` bbox filtering; spatial SQL stays here/data access.                                                      |
| [Source inventory](../../data/cascade-springs/README.md)                                                                                                       | Old KML provenance, approximate section derivation, prior checks. Retain historical source artifacts.                                          |
| [Planning catalog](../../data/trail-network/catalog.json) and [trail reference](../design/trail-network.md)                                                    | Currently marked awaiting GIS; update arrival status without claiming missing families are delivered.                                          |
| [Mobile GIS loader](../../mobile/src/data/gis.ts)                                                                                                              | Runtime validation, same-origin feature paths, combined feature IDs, full in-memory snapshot and bounds.                                       |
| [Map state](../../mobile/src/hooks/map-gis-context.tsx) and [visibility filtering](../../mobile/src/data/layer-visibility.ts)                                  | Shared snapshot; draft switches apply with Done; visibility is session-only; new IDs currently default visible.                                |
| [Native map](../../mobile/src/components/preserve-map.tsx)                                                                                                     | Currently paints all polygons as purple boundaries, points blue, and lines as trails. Must distinguish new feature families.                   |
| [Trail presentation](../../mobile/src/data/trail-presentation.ts) and [palette](../../mobile/src/constants/trail-colors.ts)                                    | All line geometries currently contribute to trail styling/legend; known route IDs determine tokens.                                            |
| [Feature details](../../mobile/src/data/feature-details.ts)                                                                                                    | Allowlisted plain text, inert HTML conversion; currently shows difficulty, surface, length, provenance.                                        |
| [Layer chooser](../../mobile/src/components/layer-selection-screen.tsx)                                                                                        | Existing type descriptions cover only trail/boundary/landmark. Extend for incoming families.                                                   |
| [Disclaimers](../../mobile/src/data/disclaimers.ts)                                                                                                            | Caveats are consolidated in the Disclaimers tab per existing UI policy.                                                                        |
| [CI](../../.github/workflows/ci.yml), [fresh DB runner](../../backend/scripts/test-fresh-database.mjs), [Worker checks](../../backend/scripts/test-worker.mjs) | Currently replay legacy imports and expect ten trail sections/eight landmarks with seven approximate identities. Update alongside replacement. |

Important design constraints:

- `replaceLayers` cannot safely import roads, water, and trails from one mixed
  collection using geometry type alone: several layers share geometry types.
  Give each layer an explicit feature selection/collection, reject omissions and
  accidental duplicate assignment, and keep related replacement atomic. Avoid
  unnecessary framework construction.
- Existing lock keys are `(6342, 1)` demo, `(6342, 2)` source map, and `(6342, 3)`
  boundary. Coordinate locks/ownership when new and legacy commands touch the
  same layers; distinct advisory locks do not serialize conflicting writers.
- Favor retaining `cascade-map-trails` and `cascade-map-boundary` IDs when replacing
  those datasets. Feature IDs should follow source identity. Any different choice
  needs explicit supersession handling, not two overlapping public networks.
- Updating imports alone is insufficient: old commands, fresh-DB setup, or CI
  must not silently downgrade supplied data back to approximations. Define and
  test the selected-source/legacy-command behavior in PRs 2 and 3.
- No persistent offline GIS cache is implemented. Bundled assets or HTTP freshness
  headers do not establish offline layer snapshots, first-launch map coverage,
  report retries, or restart behavior. Do not expand into that separate project.
- Pillars remain nullable pending D-05. Do not invent assignments or public
  protective buffers. Source filenames and `isDemo: false` do not certify safety,
  surveyed accuracy, or redistribution rights.

## 5. PR 1: source foundation

**Deliverable:** a reproducible source package and ingestion contract, with no
database or mobile behavior change. Implemented in
[the source package](../../data/cascade-springs-gis/README.md); see the completion
record below for the exact handoff. The bullets retain the original planned scope.

- Suggested directory: `data/cascade-springs-gis/`, with a README, source archive,
  loose PDF/signal image, and machine-readable manifest. This is a proposed new
  path; it does not exist when this plan is written.
- Record hashes, sizes, source dates versus inferred dates, input relationships,
  projections, units, publication flags, missing attributes, and extraction limits.
  Use repository-relative paths in committed tools and metadata.
- Establish a documented extraction environment with pinned dependencies and
  repository-local intermediate output separate from original source inputs.
  During inspection, Python
  `pyshp`, `pyproj`, `rasterio`, `pymupdf`, `pypdf`, and Pillow read the relevant
  files successfully via `uv run --no-project --with ...`. System `gdalinfo`,
  `ogr2ogr`, `pdftotext`, and `pdftoppm` were unavailable. No package versions are
  pinned by this observation; select and record them in the implementation.
- Preserve ZIP structure, validate archive paths before extraction, exclude
  `.DS_Store`, and avoid carrying creator/editor workstation details into public
  GIS properties unnecessarily. Keep full originals as evidence.
- Define property names, source-ID rules, geometry ownership, derived-value
  provenance, missing-value treatment, and expected replacement behavior for PR 2.
  Keep raw fields distinguishable from normalized/derived fields.

**Acceptance:** another checkout can verify the original inputs and run the
documented inspection without access to Downloads or proprietary ArcGIS. The
manifest matches the source bytes. No layers or empty placeholders are published.

**Handoff:** record exact committed source paths, dependency setup, manifest
schema, decisions made, and one working inspection command. Do not implement
the later converters simply to make the foundation appear complete.

## 6. PR 2: supplied trails

**Deliverable:** official-source trail segments replace approximate route geometry
through PostGIS, API, and the existing map. Implemented in
[the supplied-trail record](../../data/cascade-springs-gis/TRAILS.md); scope and
acceptance below retain the original planned requirements.

- Convert all published segments from EPSG:3857 to 4326, preserving vertices and
  source identity. Avoid snapping, merging, or simplifying away topology without
  an explicit reason. Preserve the unnamed segment without guessing its identity.
- Preserve source names, color codes, segment/route IDs, surface, roughness,
  documented width units, and notes. Normalize known difficulty only where
  supplied; leave missing difficulty absent in this PR. Calculate lengths
  geodesically or in a suitable measured CRS, not raw Web Mercator distances.
- Map app route/color families explicitly, retaining distinctions between source
  trail names even when the legend groups them. Existing Bigleaf/Spur palette
  entries already exist. Preserve current display tokens initially unless a
  confirmed decision changes them; raw source colors remain available.
- Import transactionally with runtime validation, stable globally unique feature
  IDs, stale-feature removal, and conflict-safe replay. Preserve the existing
  eight My Maps landmarks until PR 3 reconciles them.
- Resolve legacy import/setup behavior so rerunning documented commands cannot
  silently restore approximate trails. Update dataset docs, fresh-DB/Worker
  assertions, CI inputs, arrival status, and trail-name disclaimers together.
- Show useful supplied attributes through the existing detail allowlist; numeric
  fields must retain their units. Keep labels/legend readable and Gateway cased.

**Acceptance:** 36 source segments round-trip without invented attributes or
duplicate approximate routes. Test repeat/concurrent import, rollback, stale
cleanup, legacy-command behavior, public/private access and bbox reads. Verify
new route families, unnamed styling, details, toggles, camera preservation, and
location-denied browsing. Include an iOS map screenshot and report Android status.

**Handoff:** final feature/layer IDs, route-family map, commands, expected counts,
legacy replacement policy, tests, screenshots, and unresolved source questions.

## 7. PR 3: PDF geographic layers

**Deliverable:** extracted map context and landmarks replace the guessed boundary
and integrate with the supplied trail network.

- Recover georeferencing and named geographic content; produce reproducible
  conversions and a visual overlay against the trail shapefile. Inspect the PDF
  visually using the PDF skill when implementing extraction.
- Publish actual boundary, water, natural-area, road, and building content with
  explicit per-layer membership. Buildings can use a documented new logical
  feature kind in the generic schema; do not misclassify them as landmarks or
  natural areas just to fit the existing TypeScript union.
- Extract/reconcile the 15 map symbols and their labels. Record symbol type,
  source location, and positional limitations. Compare with the eight My Maps
  annotations; retain source-specific information without showing duplicate
  physical landmarks or silently discarding unmatched annotations.
- Supersede the hand-drawn boundary atomically and resolve its legacy importer
  behavior. Do not delete unrelated layers or synthetic fixtures globally.
- Distinguish water, natural areas, buildings, roads and boundaries in rendering.
  Context lines must not enter the trail legend. Keep trails legible above
  context and landmarks/labels usable. Update chooser descriptions and details.
- Reconcile PDF difficulty evidence separately from segment-level fields. Record
  confirmed source precedence and the conditional South Utoy guidance before
  adding route-level difficulty fallbacks. Do not silently promote this plan's
  source observations into product approval.

**Acceptance:** valid polygons/rings and sensible bounds; no duplicated paint
passes or legend symbols imported; alignment evidence; no duplicate old/new
boundary; idempotent and atomic imports; correct per-layer membership, details,
legend exclusion, overlap styling, switches and camera behavior. Preserve existing
map/GPS/access tests and add UI screenshots.

**Handoff:** layer IDs/counts, georeferencing method and residual/alignment
evidence, landmark reconciliation table, difficulty/color decisions, and remaining
positioning uncertainty. Counts must describe extracted features, not PDF paths.

## 8. PR 4: elevation and hillshade

**Deliverable:** a bounded 2D terrain integration with documented units/alignment.
3D terrain, historical temperature, and live sensor features are outside scope.

Implemented in the [two-source terrain record](../../data/cascade-springs-gis/TERRAIN.md).
On November 12 the owner authorized approximate supplied terrain with explicit
limitations and requested a separately attributed national public elevation option.
The completed slice adds supplied-DTM and USGS 3DEP options, each containing
generalized elevation bands and bundled regenerated hillshade. Original hillshade
is preserved and boundary-registered as review evidence.

- Read the AIG grid using existing GIS libraries rather than hand-writing a
  binary decoder. Retain nodata behavior and provenance; do not put all 7.34
  million samples into a GeoJSON response or JavaScript object graph.
- Resolve/document horizontal datum uncertainty and US-survey-foot conversion
  before relying on exact alignment. Keep derived elevation properties separate
  from zero-filled source `ELEV_GAIN`; do not invent a measured ascent value.
- Choose and document portable assets: for example, a bounded raster overlay,
  contours, and/or sampled segment elevation. Measure byte size, startup, memory,
  and rendering implications before extending the API or bundling large assets.
- The current API is GeoJSON-only. If raster assets require serving, define
  ownership, same-origin/path validation, cache policy, versioning, and Worker
  asset handling; update API/architecture docs. Do not assume a URL under `data/`
  is publicly served. A bundled asset still needs explicit catalog visibility
  integration and coordinated asset/metadata versioning.
- Register the supplied hillshade using documented controls, not guessed DTM
  bounds. Compare it with terrain-derived shading. Preserve the original even
  if a regenerated overlay is more reliable; explicitly inventory how both
  sources are used. Put uncertainty in the established disclaimer surface.

**Acceptance:** validated units/transform assumptions, diagnostic alignment,
nodata transparency, bounded asset size, readable trails, independent visibility,
and correct elevation labels/details. Report actual iOS/Android native results
separately from bundle/build checks. If alignment cannot be established, document
the concrete unresolved evidence and complete independent work without presenting
guessed positioning as established geography.

**Handoff:** asset pipeline/paths, bounds/controls, unit/datum decisions, sizes,
performance observations, serving contract if added, screenshots, and limits.

## 9. PR 5: approximate cell-signal observations

**Deliverable:** a reproducible, explicitly approximate layer of recoverable
source observation classes, independent of live device connectivity.

- Establish image-to-map control points from identifiable shared evidence;
  record pixel positions, geographic positions, model, residuals, and validation
  points independent of the fit where possible. Do not assume screenshot extent
  equals preserve/PDF extent or use a single-point scale guess.
- Extract colored circular observations, excluding the legend, stars, text,
  basemap colors and decoration. Document handling of overlapping/occluded dots.
  Publish recovered observations rather than claiming complete recovery.
- Preserve source pixel coordinates and the five literal legend classes.
  Use stable IDs derived from the source/extraction scheme. Keep exact values,
  units, carrier and survey date absent unless new evidence supplies them.
- Retain classification and registration uncertainty in metadata/details and the
  consolidated disclaimers. Do not turn classes into continuous heatmaps, promise
  service, or add device signal/location collection.
- Use distinguishable point styling without confusing samples with landmarks
  or device GPS. Fit this into the existing chooser and snapshot lifecycle.
  Current new-layer visibility defaults to on; a default-off policy is a behavior
  decision to record, not an assumed existing capability.

**Acceptance:** source-vs-extracted image overlay, reproducible counts/classes,
control-point evidence, false-positive/legend exclusions, valid WGS84 positions,
repeat import and rollback, readable overlap, details and toggles. If registration
is not defensible, preserve the image as reference content and document the gap;
do not silently publish arbitrary point positions to satisfy a feature count.

**Handoff:** controls, class dictionary, recovered counts and known omissions,
reproduction/import commands, screenshots, and remaining survey limitations.

## 10. Verification commands and completion record

Commands below exist at plan-writing time; inspect manifests again on your
parent branch. New conversion/import commands must be added and documented by
the PR introducing them. Old `data:convert` converts the legacy KML only.

```sh
pnpm exec prettier --check docs/tasks/gis-data-integration-plan.md
pnpm lint
pnpm typecheck
pnpm test:ci
pnpm backend:build
pnpm --dir backend build:worker
pnpm bundle:check
git diff --check
```

Run applicable checks for your slice: PR 1 documentation/source work does not
require native builds. For database changes, use a disposable database via
`pnpm --dir backend test:fresh` after configuring an already running local
PostGIS instance. That runner currently migrates/seeds/imports twice and runs
Jest plus real Worker HTTP checks, then removes only its temporary database.
Extend it as each new import becomes active; do not run destructive resets on a
shared development database. `pnpm --dir backend test:integration` and
`pnpm backend:check` operate against the configured target and expect fixtures.

Local observation on November 11: Docker container `cascade-source-import-db-1`
was healthy on loopback port **55435**. The default tooling port is **55432**;
`CASCADE_DB_PORT` selects another port and `DATABASE_URL` overrides the derived
URL. This is session-specific context, not a prerequisite or guarantee that the
container will still exist. Recheck before use and do not print secrets. Consult
[local startup](../development/local-startup.md) and
[Windows/Android startup](../development/windows-android.md) for device workflows.

For mobile changes, verify affected acceptance paths: source load, feature
selection, hide/show, all-hidden state, camera preservation, location denial,
API failure/retry, and public/private access where affected. Confirm a failed
load does not appear to be successful empty data. Do not claim durable offline
restart/retry when no persistent cache was implemented. A new native dependency
or configuration requires a development-client rebuild; JavaScript export,
native compilation and device smoke checks are different evidence.

Every PR should finish by updating its dataset README and affected specifications,
reviewing its own diff against its actual parent, and recording:

- Committed source/derived paths and exact regeneration/import commands.
- Final layer IDs, feature counts, supersession behavior and shared contracts.
- Decisions confirmed versus still open, with source evidence and D-05 updates.
- Checks run and outcomes; device/screenshots; explicit unverified behavior.
- Parent/child PR links and the next agent's starting task.

Relevant existing tracking: [J6-22 trail geometry](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-22),
[J6-13 GIS API](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-13),
[J6-19 layer selection](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-19),
[J6-20 feature details](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-20),
[J6-23 trail styling](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-23),
[J6-21 layer tests](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-21), and
[J6-26 geometry verification](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-26).
J6-22 was In Progress and assigned to Theodore Halpern when inspected; reread
Jira for current ownership. Terrain/signal work may need separate tracking;
do not invent issue keys or mark existing items complete from this plan alone.

## 11. PR 1 completion and next-agent handoff — November 11, 2026

Branch: `gis/01-source-foundation`, based on `main` (`45a4ccd`). This PR also
includes the owner's existing `AGENTS.md` engineering-ownership addition and
this integration plan. Parent is `main`; PR 2 has not been created.

Committed originals are under `data/cascade-springs-gis/sources/`:
`CSNP_GISfiles.zip`, `CSNP Trail Map.pdf`, and `Cell Signal Strength.png`.
The [dataset README](../../data/cascade-springs-gis/README.md) documents all paths,
source relationships, evidence, environment setup, refresh policy and limits.
[Manifest schema version 1](../../data/cascade-springs-gis/manifest.json) records
original/member hashes, sizes, raw ZIP timestamps, source versus inferred dates,
CRS/units, publication flags and extraction limits. The 20 archived files remain
inside the original ZIP; only ignored intermediates contain an extracted copy.

[Inspection evidence](../../data/cascade-springs-gis/inspection.json) confirms
36 trail segments, 1,901 vertices, 36 public flags, unique GlobalID/SEGMENT_ID
values, and a 4,098.856 m geodesic segment sum. It also records PDF anchors/groups,
terrain dimensions/range/nodata/projection evidence and image dimensions. No
features, layers, placeholder catalog entries, migrations or runtime changes
are introduced. Existing approximate data and import commands are unchanged.

[The ingestion contract](../../data/cascade-springs-gis/INGESTION.md) selects
UUID-based feature IDs, raw-property allowlisting, missing-value handling,
unit-bearing normalized keys, derivation evidence, explicit geometry ownership,
publication filtering and future atomic replacement/legacy-writer requirements.
These are implementation contracts, not resolutions of the open licensing,
alignment, safety, pillar, PDF difficulty or raster/signal registration questions.

Working inspection command from the repository root:

```sh
uv run --locked --project tools/gis python tools/gis/inspect_sources.py --check
```

Python 3.12.13 and all direct/transitive inspection dependencies are pinned in
`tools/gis/`; uv 0.11.32 was used. Outputs are under ignored `.work/gis-data/`.
Source hash verification and extraction tests need only Python 3.9+ standard
library; CI now runs both independently of application checks.

Verification completed:

- All three preserved inputs and all 23 ZIP entries verified against the
  manifest; all eight integrity/extraction regression tests passed.
- Locked inspection with `--check` passed, including an offline run from a clean
  export of committed files with a newly created environment using cached
  dependencies. It did not read Downloads or any uncommitted source input.
- `pnpm verify` passed: formatting, lint, typecheck, 57 backend tests, 91 mobile
  tests, and both iOS/Android JavaScript exports. Sixteen database cases were
  skipped by the ordinary unit suite; no database import was run for this PR.
- Changed Markdown rendered through a CommonMark/table parser; relative file
  links verified. The generated full-page map preview was visually inspected.
- Final diff reviewed against the parent; `git diff --check` passed.

Native compilation, iOS/Android device execution, Linux/Windows GIS dependency
execution, field alignment, raster/signal registration, DB replacement and
durable offline behavior were not verified by this foundation. Device/runtime
work belongs to the corresponding later slices; the new CI job checks source
integrity on Linux when the PR runs.

Next agent: branch PR 2 from `gis/01-source-foundation`, read the dataset README
and ingestion contract, then implement only supplied-trail conversion/import,
legacy-command protections, related details/tests and its documented screenshots.
Retain `cascade-map-trails` and all eight existing My Maps landmarks; leave PDF
boundary/context and landmark reconciliation for PR 3. Recheck J6-22 ownership.

## 12. PR 2 completion and PR 3 handoff

PR 2: [#30](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/30).
Implementation baseline: `e687b9c`; use the current branch head, including later
handoff edits, when starting the next slice. Branch: `gis/02-official-trails`, parent `gis/01-source-foundation`
([PR #29](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/29)).
The [supplied-trail record](../../data/cascade-springs-gis/TRAILS.md) documents
exact regeneration/import commands, feature IDs, layer IDs, route-family mapping,
source attributes/units, legacy replacement policy, verification and screenshots.

Committed output: `data/cascade-springs-gis/trails.geojson`; shared mapping/raw-field
contract: `trail-contract.json` in the same directory. Conversion lives in
`tools/gis/convert_trails.py`, using PR 1's pinned environment and verified archive.
All 36 source segments/1,901 vertices are retained; nine named app families and
one unnamed segment share the existing trail renderer. GeoJSON API serialization
uses 15 decimal places to preserve the transformed coordinates. Raw source fields
remain separate from unit-bearing normalized values and derived length/mapping.

The combined `db:import:source` now selects supplied trails plus eight My Maps
landmarks; `db:import:trails` replaces only trails. Both serialize on `(6342, 2)`.
The shared helper requires explicit per-layer collections and rejects duplicate
assignments/unsupported geometry. Fresh-DB setup and CI exercise both entry
points; KML conversion/approximate section code remain archive-only. The boundary
and its lock `(6342, 3)` remain separate for PR 3.

Fourteen Python tests and conversion reproducibility passed on macOS; the source
and conversion suite also passed on Linux with Python 3.12.12 and the same locked
GIS dependencies. Converted coordinates use 12 decimal degrees with a `2e-12`
degree reproducibility tolerance for platform math; all other values match exactly.
Disposable PostGIS
checks passed 96 backend tests and real Worker HTTP/failure checks, including
mixed concurrent replay, stale cleanup, rollback, bbox and public access. All
97 mobile tests, lint/typecheck, backend/Worker builds passed. Existing iPhone 16
Plus / iOS 18.6 displayed 45 features (36 trails + eight landmarks + boundary),
source labels, palette/Gateway casing and hide/show with camera preservation.
See the dataset record for screenshots, workspace verification and final checks.

Android native execution, new native compilation, manual permission denial,
native feature-sheet tapping, field alignment and durable offline restart/retry
remain unverified. Coordinate taps were blocked by the computer-use service's
`noWindowsAvailable` error; accessibility controls and automated selection tests
worked. No PDF difficulty fallback, new pillar mapping or safety approval is
introduced. J6-22 was still assigned to Theodore Halpern and In Progress.

Next: branch PR 3 from `gis/02-official-trails`; extract/reconcile PDF context,
boundary and landmarks while preserving the supplied trail IDs and shared lock
policy. Coordinate its landmark replacement with the combined source importer.
PDF difficulty precedence, licensing and registration questions remain open.

Read the [expanded PR 3 handoff](../../data/cascade-springs-gis/TRAILS.md#pr-3-handoff)
before editing. It identifies the still-hardcoded eight-landmark writer and
guessed-boundary importer, lock coordination, the helper's single-geometry-type
limit, generic renderer/legend behavior, missing building classification, and
which PDF extraction artifacts do not exist yet. PR 3 must close those integration
gaps as part of its selected-source replacement; do not assume PR 2 already did.

## PR 3 completion record

Implemented on `gis/03-pdf-map-layers`, stacked on
[PR 2 #30](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/30).
The [PDF map handoff](../../data/cascade-springs-gis/PDF-MAP.md) documents exact
commands, layer/feature IDs, 15-symbol reconciliation table, registration
method/residuals, source limits and owner-confirmed unchanged difficulty.

Committed `pdf-map.geojson` has one boundary, two water polygons, two natural-area
polygons, three road footprints, three building footprints and 22 landmark/source
annotation points (15 PDF symbols plus seven unmatched My Maps annotations).
Waterfall retains its original My Maps feature on one PDF marker. The two spring
references remain explicitly unresolved. Supplied trails remain unchanged; the
selected total is seven layers/69 features. Original source bytes are unchanged.

The converter uses the PDF's embedded spherical Mercator registration, explicit
vertical-origin handling, projected interpolation, 0.1-point curve tolerance,
0.001-point precision union, holes and viewport clipping. Committed review
evidence overlays the extracted context and shapefile on the PDF. All 1,901 trail
vertices compare at median 0.118 m / p95 0.220 m / max 0.265 m to the nearest PDF
trail stroke, without a fitted correction; this is not field accuracy evidence.

`db:import:source` replaces all seven selected layers atomically. New
`db:import:pdf` and legacy `db:import:boundary` select the same six PDF/context
layers. All share `(6342, 2)` with trail-only import, preventing legacy downgrade.
Runtime contracts add `building` and road polygons without new tables. Rendering,
chooser descriptions, detail allowlists, hit priority and disclaimers distinguish
context/POIs/annotations while retaining trail key, GPS and camera behavior.

Verification: 19 GIS tests and exact PDF snapshot reproducibility on macOS and
Linux (Python 3.12.13 / 3.12.12, same locked GIS dependencies); fresh disposable
PostGIS/Worker checks including
concurrent legacy replay, stale removal, complete rollback, membership, public/
private and bbox reads; backend/Worker builds; repository formatting, lint,
typechecks, 90 backend unit tests, all 107 backend tests in the disposable
database run, 99 mobile tests and both platform JavaScript exports passed.
Markdown rendering/relative links and `git diff --check` were also checked.

Existing iPhone 16 Plus / iOS 18.6 client on Metro 8082 / Worker 8788 showed
69 features with location off. Zoom revealed labels and context styling. Hiding
water changed 69→67 and restoring it returned 69 without moving the zoomed camera.
Screenshots: [overview](../images/ios-pdf-map-layers.png),
[labels](../images/ios-pdf-map-labels.png), [chooser](../images/ios-pdf-map-chooser.png).
Android native execution, new native compilation, manual permission-denial and
native feature-sheet tapping remain unverified. Visual Markdown browser preview
was blocked by local-file URL security policy; HTML rendering and local-link checks passed. Coordinate taps still fail with
`noWindowsAvailable`; automated details/GPS tests pass. No durable offline cache
or safety approval is introduced. The local selected dataset was refreshed;
existing services remain running.

Next: branch PR 4 from `gis/03-pdf-map-layers`; read the PDF handoff and PR 4
section. The embedded PDF transform is not a terrain/hillshade registration.
Terrain datum/units/alignment, signal registration, source licensing and field
verification remain open. Keep difficulty unchanged per the owner's November 12
response; do not add PDF route fallbacks in later slices without a new decision.

## PR 4 completion record

PR 4: [#32](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/32) (draft).
Branch `gis/04-terrain`, based on `gis/03-pdf-map-layers` at `7fd3a3e`, stacked on
[PR 3 #31](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/31).
The [terrain handoff](../../data/cascade-springs-gis/TERRAIN.md) documents source
paths, units/datum assumptions, regeneration/acquisition/import commands, controls,
asset versioning and remaining limits. The owner's existing Markdown edits to
this plan and `AGENTS.md` are included. Concurrent hosting work/configuration is
outside this PR and was not reverted.

Two source layers: `cascade-terrain-supplied` has 28 elevation
band polygons plus one bundled hillshade footprint; `cascade-terrain-usgs` has
32 bands plus one footprint. Combined selection is nine layers/131 features.
Each option includes generalized 20 ftUS bands, close-zoom labels, source/reference
details and regenerated gray relief. The final UI groups them under one Elevation
switch and source dropdown, defaults to USGS and renders one source at a time.
The expanded dropdown explains their similar appearance and source limits;
the original detailed source caveats remain in Disclaimers. Source descriptions
make attribution/limits explicit. No pillars, ascent, difficulty, GPS or durable
offline semantics are inferred.

Original AIG/PNG remain unchanged inside the preserved archive. A new 787,694-byte
national GeoTIFF and complete acquisition record are committed as
`sources/usgs-3dep.*`. Normal conversion is offline. Rasterio/GDAL reads the AIG;
the exact ftUS ratio is `1200/3937` metres. Supplied horizontal datum remains
unknown and uses an explicitly authorized ballpark/no-datum-shift assumption.
The PNG is registered from eight shared boundary fit corners and seven withheld
corners (maximum validation residual 1.145 m); diagnostic comparison with both
grids supports approximate alignment, not survey accuracy or terrain-change claims.
The runtime regenerates relief to avoid importing the PNG's baked-in boundary.

Terrain GeoJSON is 469,759 bytes formatted / 324,996 bytes compact. Bundled PNGs
total 287,363 bytes; decoded RGBA buffers total 1,572,864 bytes, excluding native
overhead. Desktop Node parsing observed ~0.7–0.8 ms median and 730 KB immediate
heap allocation. These are bounded-data observations, not device startup/frame
budgets. Footprint version/source hash/image hash/coordinates must match bundled
metadata or the mobile load fails visibly. The API remains GeoJSON-only; no
raster serving/Worker asset binding is added. Source and terrain-only imports are
atomic, share `(6342, 2)` and preserve unrelated layers.

Verification completed on macOS with Node 24.21.0/pnpm 10.26.2 and the locked GIS
environment: 27 GIS regression tests and reproducible conversion checks;
`pnpm verify` (formatting, lint, typechecks, 105 backend unit tests with 22 DB
cases skipped, 109 mobile tests after the grouped-source update, iOS/Android
JavaScript exports); backend/Worker
builds; fresh disposable PostGIS with all 127 tests, repeated/concurrent imports,
stale cleanup, complete rollback, bbox/private reads and real Worker HTTP/failure
checks. Final diff/`git diff --check` passed. Sandbox loopback/cache restrictions
required rerunning affected checks with normal host access; final runs passed.
The first Linux CI run exposed floating-point hashing and PNG-compression
differences. Sampling bounds are now canonicalized to one micrometre; checks
require exact geometry/properties and decoded RGBA pixels while still validating
the published PNG byte hashes exactly. All eight terrain tests also passed in
an x86 Linux container (Python 3.12.12; same locked GIS libraries).

The initial two-switch iPhone 16 Plus/iOS 18.6 verification showed
9 layers/131 features with location off, readable trails above terrain, source
descriptions and independent terrain switches. Disabling supplied terrain
left the national option and changed the count to 8 layers/102 features without
moving the camera. Screenshots: [both sources](../images/ios-terrain-both.png),
[USGS only](../images/ios-terrain-usgs.png), [source chooser](../images/ios-terrain-chooser.png).

The final grouped UI was verified November 13 on Cascade iOS 26/iOS 26.3 with
this branch's Metro bundle. One Elevation switch opens a source dropdown with
both limitations and the similarity note. Applying Supplied DTM showed eight
layers/98 features, disabling Elevation showed seven/69, and selecting USGS
restored eight/102. The disabled chooser remembered Supplied DTM; changing
sources did not refit the map. The shared local API also contained a separately
developed cell-signal layer, which was hidden for this check without changing
its data. Location stayed off. Screenshots: [source dropdown](../images/ios26-terrain-source-dropdown.png),
[supplied terrain](../images/ios26-terrain-supplied.png),
[USGS terrain](../images/ios26-terrain-usgs.png). The 109 mobile tests include
draft cancellation, disabled-source memory, refresh retention and fallback
when a source is no longer public.
The dropdown uses one rotated chevron from the existing `expo-symbols` library
so its expanded/collapsed shapes and stroke weights match. Both states were
visually checked on iOS 26; [collapsed source button](../images/ios26-terrain-source-collapsed.png).
Selecting either source now keeps the menu expanded so both source descriptions
and the similarity note remain available. Only the source button collapses it;
this interaction was verified on iOS 26 and in the terrain regression suite.

Native coordinate scrolling/tapping still encounters `noWindowsAvailable` in
computer use; accessibility switch actions work. Native band-detail tapping,
close-zoom elevation-label review, manual permission denial, Android execution,
new native compilation and quantified device memory/frame time remain unverified.
No field accuracy, durable offline restart/retry, 3D or safety approval is claimed.

The local source database was refreshed. Verification used Metro 8086 and Worker
8788; Expo's virtual env module retained the existing `.env.local` API URL, so
that file was left unchanged and the test Worker used its configured port.
Production hosting files were not changed. PR 5 starts from this branch, retains
the nine selected layers and shared import lock, and registers signal-image
observations against its own evidence rather than borrowing terrain image bounds.
