# Approximate cell-signal observations (PR 5)

The preserved [Cell Signal Strength.png](<sources/Cell Signal Strength.png>) is a
932 × 662 screenshot with colored observations and annotations, without embedded
georeferencing. [signal.geojson](signal.geojson) contains **677 recoverable points**
in `cascade-cell-signal` (`layerType: cell_signal`, `pillar: null`). Combined source
selection has ten layers / 808 features: the existing nine layers / 131 features
plus these samples. This is an approximate source-image recovery, independent of
live device connectivity. Original source bytes are unchanged.

## Reproduce and import

Run from the workspace root with the existing locked development environment:

```sh
uv run --locked --project tools/gis python tools/gis/convert_signal.py --evidence
uv run --locked --project tools/gis python tools/gis/convert_signal.py --check
uv run --locked --project tools/gis python -m unittest discover -s tools/gis -p 'test_convert_signal.py'
pnpm --dir backend db:import:signal
# Or atomically replace all ten selected source layers:
pnpm --dir backend db:import:source
```

Configure a local PostGIS target as described in the [backend guide](../../backend/README.md).
Normal conversion is offline and verifies the preserved sources against their
manifest. It uses no Downloads files, remote basemap service or OCR. Diagnostics
are regenerated under ignored `.work/gis-data/`; `--evidence` refreshes the two
committed overlays and JSON report under `review/`. `--check` compares parsed
GeoJSON and the numeric extraction/registration report exactly, independently of
JSON whitespace. It does not assert PNG byte equality across encoders.

## Registration and limits

[signal-review.json](signal-review.json) records manually reviewed pixel/geographic
controls, source identity, image dimensions, excluded regions and acceptance gates.
The model is a north-up affine in EPSG:3857 with independent horizontal/vertical
scales, centered least squares and conversion to WGS84. The screenshot appears
vertically rescaled, so a single uniform scale is unsuitable. No terrain image
extent or assumed park bounding box is used.

Six fit controls use the Cascade/Veltre road intersection and distinctive eastern
boundary steps/corners. The road control is manually read at `(365, 333)` on the
0.6-scale [PDF review overlay](review/pdf-map-overlay.png), using the PDF's embedded
registration. Boundary coordinates come from the extracted PDF boundary. Four
withheld basemap controls cover one additional eastern step, two western/interior
trail junctions and the broad northern boundary crest. The latter is withheld
because the crest is not a sharp, identical feature in both basemaps.

| Comparison                                      | Count | Maximum ground residual |
| ----------------------------------------------- | ----: | ----------------------: |
| Fitted road/boundary controls                   |     6 |                 4.256 m |
| Withheld basemap controls                       |     4 |                27.353 m |
| Qualitative parking/waterfall annotation checks |     2 |                30.760 m |

The [registration report](review/signal-extraction.json) records the affine,
individual residuals, controls and provenance. Gates are 15 m for fit controls,
30 m for withheld basemap controls, and 50 m for qualitative annotation checks.
Annotation stars are **not fitted controls** or survey validation; cartographic
symbols may be displaced. The northern park cutout differs substantially between
the screenshot basemap and supplied boundary and is excluded from fitting.
Some samples extend beyond the controls, particularly southwest; no accuracy bound
is established there. The [registration overlay](review/signal-registration-overlay.png)
shows supplied trails in magenta, the PDF boundary in orange, blue fit controls,
black checks and residual vectors. Control agreement does not establish GPS,
survey, navigation or source-class accuracy. Source GPS drift remains unknown.

## Extraction and class dictionary

[convert_signal.py](../../tools/gis/convert_signal.py) identifies near-literal
colored cores with a maximum RGB channel difference of 18 and four-connected
components. Eligible cores contain 7–36 pixels and span 3–7 pixels in each axis;
their bounding-box centers are recorded in source half-pixels. Tiny/narrow color
fragments, oversized merged cores and components touching exclusion edges are
omitted. There is no inferred hidden-circle center or interpolation.

| Transcribed source class | Source color | Recovered samples |
| ------------------------ | ------------ | ----------------: |
| `< -120`                 | Red          |               217 |
| `-120–-117`              | Orange       |                90 |
| `-117–-113`              | Yellow       |               116 |
| `-113–-108`              | Light green  |                92 |
| `> -108`                 | Dark green   |               162 |

These are categorical legend transcriptions, with typography normalized for
display. Exact measurements and interval endpoint inclusivity are not inferred.
Units, carrier, device and survey date are absent; **do not label the values dBm**
or describe them as current connectivity. The [shared contract](signal-contract.json)
contains the class colors/counts, allowed properties, source hash and version.

The legend rectangle and six annotation-star boxes are explicitly excluded.
Text, gray basemap trails/buildings and decoration do not pass color/core criteria.
The [extraction overlay](review/signal-extraction-overlay.png) draws magenta rings
around recovered cores and blue exclusion boxes. The JSON report retains rejected
component bounds for review, but their count is not a count of missing samples.
Dense same-color overlaps, cross-color occlusion and dots under annotation boxes
limit completeness. Partial cores may shift the estimated center or obscure a
different class. **677 is a recovered count, not the original survey count.**

## Ownership, validation and presentation

Feature IDs are `csnp-signal-v1-XXXX-YYYY`, where each padded integer is twice the
source pixel coordinate. Registration-only corrections can preserve pixel identity;
source/extraction changes require reviewed version/identity handling. Each Point
retains `signal_class`, `source_pixel`, `source_dataset`, `source_file`,
`source_sha256`, `extraction_version`, `positioning`, `name` and `isDemo: false`.
No measured value, unit, carrier or date is manufactured.

Both signal-only and combined source writers validate the class totals, IDs,
pixel ranges, source/version, allowed properties, WGS84 bounds and Point geometry
before connecting. They share advisory lock `(6342, 2)` with trail/PDF/boundary/
terrain writers. Replacement removes stale signal features transactionally and
preserves other layers. Combined replacement is one transaction across all ten
selected layers. A late feature identity conflict rolls back all changes.

Public APIs retain their existing bbox filtering and public/private rules. The
mobile loader rejects incomplete or unsupported signal snapshots visibly. Small,
dark-outlined class dots sit below landmarks and trail strokes; they never enter
the trail key or landmark labels. A separate horizontally scrollable class key
appears only while samples are visible. Feature details show the source class,
pixel and positioning metadata; standing limits are consolidated in Disclaimers.
Landmarks retain tap priority in crowded hits. Chooser changes follow existing
draft/Done/Back, new-layer-visible and session-only behavior; GPS is separate.

No native dependency, physical GIS table, endpoint, device cellular/location
collection, heatmap or durable offline cache is introduced. The committed signal
GeoJSON is about 414 KB compact before transport compression. GIS extraction
libraries and source images stay outside the mobile/Worker runtime bundles;
mobile bundles only the small class contract. Licensing, survey provenance,
field accuracy, pillar assignment and safety approval remain open under D-05.

## Verification and handoff

Primary native target is **iOS 26**, per the owner's November 13 instruction.
The existing `Cascade iOS 26` iPhone 17 / iOS 26.3 client loaded ten layers / 808
features with location off through Metro 8087 and Worker 8792. At close zoom,
samples/landmarks/trails remained distinguishable. Applying signal off changed
808 → 131 and removed the class key; restoring it returned 808 without moving
the zoomed camera. Native coordinate sample tapping remains unverified because
Computer Use returns `noWindowsAvailable`; automated hit/detail checks pass.

Screenshots: [chooser](../../docs/images/ios26-signal-chooser.png),
[hidden](../../docs/images/ios26-signal-hidden.png),
[samples](../../docs/images/ios26-signal-map.png).

The GIS suite passes all 32 tests, including five signal regression tests and exact
signal reproduction. All 148 backend tests pass in a disposable PostGIS database,
including concurrent writers, stale cleanup, signal-only/full-source rollback,
bbox/privacy and real Worker HTTP/database-failure checks. Integration tests have
a 30-second allowance for repeated full-dataset imports; unit tests retain five
seconds. Final workspace/build checks are recorded in the stack completion record.

Android native execution, new native compilation, manual permission denial,
field alignment, quantified device memory/frame time and durable offline
restart/retry remain unverified. No new native build is required by this slice.
PR 5 starts at PR 4 commit `49c3211`; original-checkout terrain chooser edits are
preserved separately and are not included in this stacked diff. Restack normally
after parent changes land, resolving the small chooser/catalog/doc overlaps without
dropping this signal layer. Retain the original screenshot and review artifacts
when replacing this recovery with a future raw survey dataset.
