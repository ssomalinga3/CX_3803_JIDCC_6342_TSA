# Supplied Cascade Springs GIS sources

**PR 4 selection:** [Two-source terrain](TERRAIN.md) adds supplied-DTM and national
USGS 3DEP elevation options under one switch and source dropdown (bands plus relief).
The selected total is nine layers/131 features. The supplemental USGS GeoTIFF and
acquisition record live in `sources/usgs-3dep.*`; the terrain converter checks that
record separately from the unchanged original three-input manifest. Original
supplied hillshade is registered review evidence; runtime relief is regenerated.

**PR 3 selection:** see [PDF map integration](PDF-MAP.md) for the six extracted/context layers, landmark reconciliation, commands and alignment evidence.

**Current integration:** [PR 2 supplied trails](TRAILS.md) now replaces active
approximate trail geometry. The preservation notes below describe PR 1; original
inputs and their manifest remain unchanged.

PR 1 of the [integration stack](../../docs/tasks/gis-data-integration-plan.md).
The project owner authorized integration of the supplied files on November 11, 2026. This package preserves evidence and defines the ingestion handoff; it does
not import data, publish layers, change the API, or change the mobile map.
Related tracking: [J6-22](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-22),
[J6-13](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-13), and
[J6-26](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-26).
J6-22 remained In Progress, assigned to Theodore Halpern, at implementation review.

## Original inputs and relationships

The three originals in `sources/` are unchanged bytes from the owner-supplied
folder. The complete extracted duplicate is deliberately not committed.
[manifest.json](manifest.json) records every original's SHA-256 and byte size,
and all 23 ZIP entries (20 files, three directories, 33,262,116 uncompressed
file bytes). No Git LFS, ArcGIS installation, Downloads path, network data fetch,
or database is needed to verify them.

| Committed original                                             |      Bytes | Contents and relationship                                                                                                |
| -------------------------------------------------------------- | ---------: | ------------------------------------------------------------------------------------------------------------------------ |
| [CSNP_GISfiles.zip](sources/CSNP_GISfiles.zip)                 | 20,423,428 | `CSNP/OfficialTrailsCSNP.*`, `HillshadeCSNP.png`, `csnp_dtm_2015/`, and supporting `info/`; keep this structure together |
| [CSNP Trail Map.pdf](<sources/CSNP Trail Map.pdf>)             |  1,710,288 | Layered map with embedded georeferencing, context geometry, legend, and landmarks; trail geometry overlaps the shapefile |
| [Cell Signal Strength.png](<sources/Cell Signal Strength.png>) |    300,059 | Unregistered screenshot of approximate signal classes; registration requires shared geographic evidence                  |

The shapefile has 36 single-part line segments and 1,901 vertices, in EPSG:3857
metres. Inspection transforms coordinates in memory for bounds and computes a
WGS84 ellipsoidal segment-length sum of 4,098.856 m; it writes no GeoJSON. The
sum is not a hiking itinerary or surveyed mileage. All 36 `PublishTra` values
are `TRUE`. Both `SEGMENT_ID` and `GlobalID` are unique; `TRL_ID` has only seven
distinct values and must not determine route identity. The unnamed segment is
retained. Full name, surface, roughness, color, missing-value, and field inventories
are in [inspection.json](inspection.json).

Source XML records metadata creation on December 30, 2025 and export on April 9, 2026. PDF metadata records creation on April 14, 2026 without a timezone.
These are document/export dates, not survey dates. `2015` is inferred only from
the terrain directory name; acquisition dates for all inputs remain unknown.
ZIP modification times have no timezone and do not establish acquisition dates.

The PDF has one 1,584 × 2,448 point page, optional-content groups, and `/VP`
georeferencing. Its `/GPTS` pairs are **latitude, longitude**, unlike GeoJSON.
The committed inspection retains its projected WKT and geographic anchors.
Drawing Y origins differ from PDF page Y origins. Rounded anchors, displaced
symbols, legend content within the viewport, repeated water paint passes, and
polygon holes require review in PR 3. Source trail geometry comes from the
shapefile, not another traced copy of the PDF trail strokes.

The AIG grid is 3,369 × 2,178 float32 cells with 7,337,682 valid cells and a source
range of approximately 809.32–1,037.27 feet. Its `prj.adf` specifies NAVD88 height
in US survey feet. GDAL interprets horizontal units as US survey feet; the
horizontal datum remains unidentified. The projection parameters and original
projection text are recorded without assigning an EPSG datum. Use the exact
US-survey-foot ratio `1200/3937` metres only where that unit is established.
Preserve the nodata sentinel/mask even though this snapshot has no nodata cells.

The 1,156 × 776 hillshade has no supplied geographic transform/world file.
Do not stretch it to the DTM bounds. The 932 × 662 signal image likewise lacks
georeferencing. Its five literal classes have no confirmed measurement units,
carrier, exact readings, device, or survey date. Both images need registration
controls and alignment evidence before producing positioned layers.

## Reproduce verification and inspection

Run from the repository root. Integrity checks and extraction need only
Python 3.9+ and its standard library:

```sh
python3 tools/gis/source_package.py verify
python3 -m unittest discover -s tools/gis -p 'test_source_package.py'
python3 tools/gis/source_package.py extract
```

On Windows, use `python` where `python3` is unavailable. `verify` checks original
hashes/sizes and the entire archive inventory, including member hashes, paths,
directory entries and raw modification dates. CI runs verification and the safe
extraction tests without installing GIS dependencies.

Full inspection uses the isolated development environment in
[tools/gis/pyproject.toml](../../tools/gis/pyproject.toml),
[uv.lock](../../tools/gis/uv.lock), and
[.python-version](../../tools/gis/.python-version). Tested with uv 0.11.32,
Python 3.12.13, Node 24.21.0, and pnpm 10.26.2. Install uv using its
[official instructions](https://docs.astral.sh/uv/getting-started/installation/).

```sh
uv sync --locked --project tools/gis
uv run --locked --project tools/gis python tools/gis/inspect_sources.py --check
```

`uv` obtains the pinned Python runtime if needed. Initial environment setup needs
package-download access; subsequent inspection runs use only local source data.
The lock includes transitive dependencies and artifact hashes from public PyPI.
Direct pins: pyshp 3.1.8, pyproj 3.8.0, rasterio 1.5.2, PyMuPDF 2.1, pypdf 7.0.1,
Pillow 13.0.0. Binary wheels supply the GIS readers; no proprietary software or
system `gdalinfo`, `ogr2ogr`, or Poppler is required. These dependencies are outside
the pnpm workspace and never enter backend/mobile runtime bundles.

Outputs live under the ignored repository-local `.work/gis-data/`:

- `extracted/CSNP/`: original archive hierarchy, including AIG/supporting files.
- `inspection.json`: field definitions/counts, CRS evidence, bounds, dimensions,
  placeholder counts, geodesic length, grid range/nodata, and PDF anchors/groups.
- `map-preview.png`: a full-page PDF preview for source review.

Inspection verifies originals before extracting, then reads the grid in blocks.
`--check` compares portable observations with committed `inspection.json`;
GDAL WKT serialization and tiny transform-format differences are not compared.
Omit `--check` to inspect an intentionally refreshed source before reviewing the
new report. Reports omit creator/editor values and workstation paths. The full
originals retain this evidence, but it must not be copied wholesale into public
GIS properties. PDF previews are diagnostic only, not georeferenced overlays.

Extraction validates every archive path before writing, rejects absolute paths,
traversal, links, encrypted entries, case collisions and nonportable Windows
names, and caps members at 128 MiB / total uncompressed size at 256 MiB.
`.DS_Store` and `__MACOSX` stay in the original if present but are excluded from
extraction. Existing identical outputs are retained; modified files/type conflicts
or symlink targets cause an error. Move conflicting intermediates aside and rerun.
There is no recursive cleanup or deletion command.

## Manifest format and deliberate refresh

`schema_version: 1` identifies this source-package format. All committed paths
are repository-relative; `archive_paths`/`archive_members[].path` are ZIP-relative.
`archive_paths` may use a descriptive `*` glob; the exact inventory is exhaustive.

- `package_id` and `preserved_on` identify this snapshot and preservation date.
- `inventory.inputs[]`: exact `path`, `bytes`, and lowercase hexadecimal `sha256`.
- `inventory.archive_members[]`: `path`, `kind`, uncompressed `bytes`, raw
  `zip_modified_at`, `extract` policy, and `sha256` for files only.
- `datasets[]`: unique `id`, owning `input`, optional archive paths, format,
  source/inferred `dates` with evidence, nullable acquisition date/CRS/units,
  geometry ownership, input relationships, publication policy, limits, and
  `published_by_this_pr: false`. Missing information is JSON `null` or an empty
  evidence list; it is never an invented date, datum, unit, or publication flag.

Source verification compares the complete `inventory` to recomputed values; it
does not certify the curated interpretations in `datasets`. Review those with
the source evidence and [D-05](../../docs/decisions.md) when inputs change.

To refresh, replace only explicitly reviewed originals, run
`python3 tools/gis/source_package.py inventory` to obtain the new inventory,
review/update the manifest and source evidence, move the prior extraction aside,
and rerun inspection. Review the regenerated report before replacing the committed
`inspection.json`. Never resolve a hash failure by silently accepting new bytes.
Do not use filesystem timestamps or Downloads as a handoff dependency.

## Ingestion handoff and remaining decisions

[INGESTION.md](INGESTION.md) defines property names, source identities, geometry
ownership, derivation provenance, missing values, and replacement requirements
for PR 2. This is a development contract, not a new HTTP endpoint or a schema
migration. Existing imports, approximate features, UI, and catalog status are
unchanged until the later implementation PRs replace them.

PR 2 starts from `gis/01-source-foundation`, reads the preserved shapefile from
`extract`, and implements conversion/import with the current tests and legacy
command protections. Retain `cascade-map-trails` and the eight My Maps landmarks;
boundary replacement belongs to PR 3. No empty layers are published here.
Pillar mapping, source licensing, surveyed alignment, safety buffers, PDF
difficulty precedence, terrain registration and signal registration remain open.
Owner authorization to integrate these files does not settle those questions.

## Foundation verification

The source verifier, all eight extraction/integrity regression tests, and locked
inspector with `--check` pass on macOS. An offline inspection also passed from
a clean export of committed files with a fresh environment and cached locked
dependencies. `pnpm verify` passed, including 57 backend tests, 91 mobile tests,
and both platform JavaScript exports. Original inputs are byte-for-byte copies;
no converter, database import, native build or device check is part of this foundation.
The PR completion record in the [stack plan](../../docs/tasks/gis-data-integration-plan.md)
records the full final checks and next starting task.
