# Supplied-source ingestion contract

Engineering handoff for PR 2, established by the source-foundation task. These
names and rules are implemented by the [PR 2 converter/importer](TRAILS.md).
Runtime types now include supplied attributes and unassigned trail identity;
no physical table or endpoint is added. Use the existing generic
tables and [public read contract](../../docs/api.md#implemented-public-gis-reads-november-1-2026).
See [source evidence](README.md) and the [stack plan](../../docs/tasks/gis-data-integration-plan.md).

## Feature identity and geometry ownership

The shapefile owns trail centerline geometry. Preserve its 36 segments and 1,901
vertices without snapping, merging, simplifying, or tracing extra PDF strokes.
Transform EPSG:3857 to WGS84 longitude/latitude (SRID 4326), explicitly controlling
axis order. Preserve part topology and validate finite, nonempty geometries,
coordinates, bounding extent, feature IDs, and property values at conversion and
import boundaries. Publication filtering applies before producing public output.

Use feature ID `csnp-official-trail-<GlobalID UUID>`: parse the source UUID,
remove braces and serialize canonical lowercase hyphenated form. Validate every
UUID and require uniqueness of both UUID and nonblank `SEGMENT_ID`; duplicates
or missing identities fail conversion rather than falling back to row order,
name hashing or `TRL_ID`. Names and geometry may change without changing identity.
Preserve exact source strings separately. Current `SEGMENT_ID` and `GlobalID`
each have 36 distinct, nonmissing values; the UUID form was verified.

Keep `cascade-map-trails` as the replacement layer ID. A feature belongs to
exactly one explicitly selected layer, even when roads/water/trails share line
geometry types. Reject unassigned or multiply assigned public features. Do not
feed a mixed context collection into the current geometry-only layer selector.
The PDF owns contextual boundary/water/natural-area/road/building geometry and
landmark evidence in PR 3; PDF trails are reconciliation evidence only. AIG owns
elevation samples in PR 4. Image observations remain unpositioned until their
registration is supported. Archive `info/` is supporting data, not a layer.

PR 4's [terrain contract](TERRAIN.md) adds generalized elevation bands and bundled
relief, with one independently switchable layer per supplied/USGS source. Terrain
polygons/footprints retain their own identities, source/dataset versions, units
and hashes. They never replace trail attributes or infer source ascent. Terrain-only
and combined imports share `(6342, 2)` with the existing selected-source writers.

## Public trail properties

Keep normalized keys consistent with
[trail-network.ts](../../backend/src/modules/gis/trail-network.ts); PR 2 must
extend/validate types for newly implemented attributes. Missing optional keys
stay absent from normalized public properties. Raw missing/zero values may
remain in the explicitly allowlisted source evidence object.

| Key                     | Meaning and normalization                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                  | Trimmed source `TRL_NM`; for blank input use the display fallback `Unnamed trail segment` and `name_assignment: unassigned`                                                   |
| `feature_kind`          | `trail`                                                                                                                                                                       |
| `trail_id`              | Explicit app route/color family mapping reviewed in PR 2; never derived from `TRL_ID` alone. Leave absent for an unassigned segment, consistent with current generic features |
| `difficulty`            | Source `Difficulty` normalized to `easy`, `moderate`, or `difficult`; absent for blank input. Unknown nonblank text fails for review                                          |
| `surface_type`          | Trimmed supplied `SURFACE`, absent when blank                                                                                                                                 |
| `roughness`             | Trimmed supplied `ROUGHNESS`, absent when blank; not converted to difficulty                                                                                                  |
| `average_width_in`      | Finite positive `AVG_WIDTH`, explicitly inches per XML lineage alias; zero/blank absent                                                                                       |
| `description`           | Trimmed supplied `NOTES` as inert plain text, absent when blank; not a live condition alert                                                                                   |
| `length_m`              | Measured sum for this segment, derived geodesically on WGS84 with recorded method; not raw Web Mercator length or an itinerary length                                         |
| `color`                 | Existing app display token if emitted; no direct interpretation of a source color word as a hex value. Raw source color remains separate                                      |
| `source_dataset`        | `csnp-official-trails`                                                                                                                                                        |
| `source_file`           | ZIP-relative `CSNP/OfficialTrailsCSNP.shp`                                                                                                                                    |
| `source_archive_sha256` | Original ZIP SHA-256 from the manifest, identifying the complete source bundle                                                                                                |
| `source_crs`            | `EPSG:3857`                                                                                                                                                                   |
| `source_feature_id`     | Exact original `GlobalID`, including braces/case                                                                                                                              |
| `source_segment_id`     | Exact original `SEGMENT_ID`                                                                                                                                                   |
| `source_properties`     | Allowlisted original DBF names/values described below; not a dump of all metadata                                                                                             |
| `derived_values`        | Per-key provenance object for measured or mapped values; never presented as raw provider measurements                                                                         |

For a derived length, use a provenance entry such as
`derived_values.length_m = { method: 'WGS84 ellipsoidal segment sum', tool: 'pyproj.Geod', source_dataset: 'csnp-official-trails' }`.
Record tool versions in conversion metadata and hashes in the source manifest.
For route mapping, retain source name, explicit mapping table/version and
`derived_values.trail_id` method. Do not claim source `TRL_ID` is the app family.
Keep Turkeyfoot and South Utoy names distinct even if the app legend shares a
family. Keep the current display palette until a confirmed decision changes it;
the source West Trail `ORAN` value remains available alongside the app red token.

`source_properties` allowlist, retaining original key case:
`TRL_NM`, `TrailColor`, `AVG_WIDTH`, `PARK_ID`, `TRL_ID`, `SEGMENT_ID`, `GlobalID`,
`SURFACE`, `ROUGHNESS`, `NOTES`, `Difficulty`, `PublishTra`, `USE_LEVEL`, `GRADE`,
`ELEV_GAIN`, `LENGTH_MI`, `Shape__Len`, `AvgSegment`, `Shape__L_1`.
Preserve source strings and numeric zero placeholders here, with JSON `null`
for a source null. Do not rename truncated DBF names to the XML's longer names.
Exclude `CREATOR`, `EDITOR`, workstation paths and XML process logs from public
properties. Originals preserve all fields, including empty create/edit dates;
those dates need not be copied into the API.

Only Big Beech Spur supplies difficulty and nonzero source grade/mileage. Do
not infer the other 35 difficulty values from roughness, colors, or this plan's
PDF observations. `ELEV_GAIN`, `AvgSegment` and `Shape__L_1` are all zero, three
widths are zero and `USE_LEVEL` is blank. Omit corresponding normalized values.
Unknown grade/elevation-gain units stay unknown; a later terrain-derived ascent
must use a distinct field/provenance, not overwrite source zero as a measurement.

## Publication and replacement

Treat `PublishTra` as the source publication gate: literal `TRUE` is eligible,
`FALSE` is excluded from all public geometry and public properties, and missing
or unrecognized values fail conversion for review. Do not default to public.
Retain the exact raw flag for eligible rows. Every current row is `TRUE`.
Layer `pillar` remains null pending D-05. `isDemo: false` describes sourced data;
it does not establish redistribution rights, safety, or surveyed accuracy.

PR 2 must replace only owned trail features atomically and remove stale owned
IDs, including the approximate sections, while preserving the existing eight
My Maps landmarks. Do not delete unrelated layers, fixtures, or boundaries.
Validate the entire replacement before committing any changes; replay and
concurrent runs must be duplicate-safe, and failed conversion/import must leave
the previous complete dataset intact. A source flag change to `FALSE` must
remove that previously public segment on the next successful replacement.

Coordinate conflicting writers, not just new import calls. The current source
import uses advisory lock `(6342, 2)` and also touches landmarks; boundary uses
`(6342, 3)`. New and legacy commands that touch `cascade-map-trails` need the same
serialization/ownership policy. A new independent lock is insufficient.
Fresh-DB setup, CI and documented legacy commands must select the supplied source
or fail clearly instead of silently restoring approximations. Define and test
that selection in PR 2; no behavior is changed here. PR 3 similarly coordinates
boundary supersession and landmark reconciliation.

New properties still require runtime validation, public/private and bbox tests,
PostGIS/API round trips, rollback, concurrent replay, stale cleanup and legacy
command regression checks. UI details must allowlist supported attributes with
units. Preserve existing camera/toggle/location-denied flows. No durable offline
cache or report-retry behavior is implied by this source package.

## Implemented PR 3 supersession

The preceding PR 1/2 requirements describe the historical handoff. The
[implemented PDF contract](PDF-MAP.md) supersedes the eight-point writer and
separate boundary lock: combined source import now selects seven layers/69
features, while PDF and legacy-boundary imports select six layers/33 features.
All conflicting writers use `(6342, 2)`. Every My Maps record remains recoverable;
Waterfall is nested on the PDF marker and seven unmatched annotations retain
original geometry. Buildings use their own logical kind and roads accept polygon
footprints. Original inputs and generic physical tables remain unchanged.

## Signal screenshot ownership (PR 5)

[signal-contract.json](signal-contract.json) owns `cascade-cell-signal`: 677
`signal_observation` Points with five transcribed classes, source pixels, hash and
extraction version. Backend and mobile reject invented measurement/context fields
and incomplete class sets. Pixel-derived IDs do not imply surveyed positioning.
Combined and signal-only replacement share `(6342, 2)` with all selected-source
writers; late identity conflicts roll back the transaction. Preserve this layer
when replaying trail/PDF/terrain-only commands. See [SIGNAL.md](SIGNAL.md) for exact
commands, registration/omission evidence and future source/version handling.
