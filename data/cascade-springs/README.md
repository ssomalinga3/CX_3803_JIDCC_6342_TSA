# Cascade Springs source map

Snapshot supplied for this project by the project owner on November 4, 2026.
Related work: [J6-22](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-22),
[J6-13](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-13), and
[J6-26](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-26).

- [Original map](https://www.google.com/maps/d/viewer?mid=1Q5BTcAcUwxp9Y320UwsszoCLO0k), titled **Cascade Springs Trail**.
- [KML export](https://www.google.com/maps/d/kml?mid=1Q5BTcAcUwxp9Y320UwsszoCLO0k&forcekml=1), retrieved November 4, 2026, retained byte-for-byte in [source.kml](source.kml).
- KML SHA-256: `46153f84837459d84e9a9b808898fff288dfca07a1c984375fd2b00fd7240012`.
- Source attribution/description links to [Atlanta Trails](http://www.atlantatrails.com/hiking-trails/cascade-springs-nature-preserve/).
- [features.geojson](features.geojson) preserves all nine placemarks: one LineString
  with 191 positions and eight Points. KML uses WGS84 longitude/latitude/altitude;
  all exported altitudes are zero placeholders. GeoJSON retains longitude/latitude
  exactly and omits the zero altitude for the existing 2D PostGIS column, without
  reprojection or simplification. Nonzero altitudes fail conversion for review.
  The original three-ordinate positions remain in the raw KML.
- No preserve/protective polygon, surface, difficulty or pillar classification is
  supplied. **Park boundary / fence is a point**, not a boundary polygon.
- IDs hash geometry type plus the original name, retaining identity through
  coordinate corrections. Renaming a source feature changes its ID. Duplicate
  names/types and unsupported shapes fail conversion for manual reconciliation.
- `description_html` retains original source markup and image URLs as inert text.
  No photos are downloaded, no markup is executed, and this import does not add
  an HTML renderer. Future detail views must sanitize/encode untrusted markup.

The user authorized this source's import as public GIS. This establishes neither
survey accuracy nor approval for trail safety. The export contains no explicit
redistribution license; production redistribution rights, field alignment and
navigation approval remain D-05 decisions. No license or safety certification is
inferred from public access.

## Reproduce and import

From the workspace root, after dependency installation and local PostGIS setup:

```sh
pnpm --dir backend data:convert
pnpm exec prettier --write data/cascade-springs/features.geojson
pnpm --dir backend db:import:source
```

Conversion needs Python 3 (standard library only). It operates on the checked-in
KML without network access. To refresh, explicitly download the export into
`source.kml`, review the diff and provenance/hash, then regenerate and test. Imports
never fetch Google content at runtime. Do not replace the snapshot without review.

The importer uses the existing local database configuration; verify any
`DATABASE_URL` overrides before running. It publishes `cascade-map-trails` and
`cascade-map-landmarks` with `pillar: null`, `isDemo: false`, and source attribution.
It transactionally replaces only these two source layers' features, removing stale
records and serializing concurrent imports. Any invalid geometry rolls back the
entire replacement. Other layers and their visibility are preserved. Synthetic
seeding remains an explicit separate command; run only this import on a fresh
database to view the source data alone. `isDemo: false` means sourced rather than
synthetic; it does not certify authority or accuracy.

The existing mobile client reads both layers through the public catalog and
feature endpoints, renders the trail and points, and fits their extent. API paths
and schema are unchanged. No durable offline cache is added.

## Verification

See [approximate trail sections](#approximate-trail-sections) for the later naming slice.

```sh
pnpm verify
pnpm --dir backend test:fresh
pnpm backend:build
GIS_SOURCE_MAP=1 pnpm backend:check
```

`test:fresh` needs an already running local PostGIS database. It creates an
isolated temporary database, migrates twice, seeds twice, imports twice, exercises
Jest integration and real Worker HTTP, then drops only its temporary database.
CI imports the snapshot before integration and enables source Worker checks with
`GIS_SOURCE_MAP=1`. For that optional check, run both `db:seed` and
`db:import:source` on its target database; the default check still supports the
original demo-only setup.
Tests compare every GeoJSON coordinate/property with the KML conversion, validate
malformed data, verify source round trips and bbox filtering through PostGIS/API,
concurrent replay/stale cleanup, and transactional rollback. Native rendering,
bundle exports and automated backend checks are separate evidence.

## Local verification record — November 4, 2026

Verified on macOS with Node 24.21.0, pnpm 10.26.2, Docker PostGIS, and the
existing iPhone 16 / iOS 18.6 development client. No native dependencies or
configuration changed and no new native compilation was performed.

- `pnpm verify`: formatting, lint, typecheck, 32 backend unit tests, 32 mobile
  tests, iOS and Android JavaScript exports passed (13 DB tests excluded here).
- `CASCADE_DB_PORT=55435 pnpm --dir backend test:fresh`: all 45 backend tests
  passed against a fresh PostGIS database, plus repeated migration/seed/import,
  real Worker source reads, access/bbox restrictions and DB-failure/liveness.
- `pnpm backend:build` and `pnpm --dir backend build:worker`: passed.
- Actual mobile `loadPublicGis` against Worker port 8789 and the import-only
  database on 55435: two non-demo layers, nine features, valid fitted bounds.
- iOS native rendering: the imported orange trail and eight blue landmarks
  displayed on the online basemap with **Public GIS · 2 layers · 9 features**.
  [Screenshot](../../docs/images/ios-simulator-source-map.png).
- Relative documentation links and `git diff --check`: passed.

Android native execution, field/survey alignment, new native compilation, manual
permission denial, and durable offline restart/retry were not verified. GPS,
reporting and persistent offline storage are outside this data import's scope.
The pre-existing GPS branch was preserved; this branch starts from main.

## Approximate trail sections

The project owner authorized best-effort names from the
[physical sign](../../docs/design/references/cascade-springs-trail-network.png),
despite incomplete GIS, on November 4, 2026. The raw KML and nine-feature GeoJSON
remain unchanged. During `db:import:source`, the
[section mapping](../../backend/src/db/source-map-trails.ts) replaces the single
route with ten sections covering seven sign identities. The API now returns
18 features: ten lines and eight landmarks. Stable layer IDs and endpoint
paths stay the same. The `cascade-map-landmarks` ID/type is retained for
compatibility; the owner requested calling these eight source annotations landmarks.

Ranges below are inclusive, zero-based positions in the original 191-position
LineString. Adjacent sections share their endpoint. All positions and traversal
order, including original out-and-back portions, are preserved without snapping,
simplifying, extending, or guessing new coordinates.

| Range   | Display identity            | Evidence and uncertainty                                                                                                                                                                                            |
| ------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–9     | Gateway Trail               | Trailhead approach to the spring/creek junction, matching the sign's entrance path.                                                                                                                                 |
| 9–65    | Turkeyfoot/Utoy Creek Trail | Western creek-side arc and southern out-and-back; uses the sign legend's combined route family. The sign distinguishes creek portions along this arc; the southern source endpoint may predate the sign's reroute.  |
| 65–84   | West Trail                  | Northbound interior path from the southern Trail Junction to the west/central junction. Approximate sign-shape match.                                                                                               |
| 84–92   | Battle Ridge Trail          | Short eastward junction connection before Terrace; lower-confidence shape match, not the sign's full eastern Battle Ridge loop.                                                                                     |
| 92–114  | Terrace Trail               | Central east–west traverse, anchored by the source's “Left on Terrace Trail” marker near vertex 92.                                                                                                                 |
| 114–130 | Unnamed connection          | Southeast detour lacks a reliable sign correspondence.                                                                                                                                                              |
| 130–146 | White Oak Trail             | Eastern north–south leg approaching the waterfall junction, corresponding to the sign's light-blue corridor. Lower-confidence: the older source's nearby “Right on Springs Trail” annotation uses a different name. |
| 146–176 | Springs Trail               | Waterfall out-and-back and northern return toward the spring junction, matching the sign's northern route.                                                                                                          |
| 176–182 | Unnamed connection          | Spring-junction transition; identity is unclear.                                                                                                                                                                    |
| 182–190 | Gateway Trail               | Return traversal of the entrance approach; same `trail_id`, distinct section ID.                                                                                                                                    |

Bigleaf Magnolia Trail and Spur Trails are omitted as named routes because their
geometry cannot be matched confidently. This is partial coverage, not seven
complete routes. No difficulty, surface, sign color, protective area or measured
route length is inferred. Named sections carry `name_assignment: approximate`,
`name_source`, `trail_id`, the original `source_name`/`source_feature_id`, and
`source_vertex_start`/`source_vertex_end`. Unassigned connections retain provenance
with `name_assignment: unassigned`, without a guessed route identity.

The mapping pins the original route geometry's SHA-256. If it changes, import
fails before replacing database rows; review the ranges and hash together.
Re-import to replace the old combined route; replay remains transactional and
duplicate-safe. Native labels use the section names with collision handling and a
white halo. The approximate/partial-network caveat appears in the app's
Disclaimers tab, not inline on the map. Names are not surveyed or field-verified
navigation guidance.

### Naming-slice verification — November 4, 2026

- `pnpm verify`: formatting, lint, typecheck, 36 backend unit tests, 46 mobile
  tests, and iOS/Android JavaScript exports passed. Database cases run separately.
- `CASCADE_DB_PORT=55435 pnpm --dir backend test:fresh`: all 50 backend tests
  passed, including repeated imports, unchanged-coordinate reconstruction,
  stale-feature cleanup, real PostGIS rollback, public/private access and bbox
  checks, plus Worker HTTP and database-failure/liveness checks.
- `pnpm backend:build` and `pnpm --dir backend build:worker`: passed.
- Existing iPhone 16 / iOS 18.6 development client: native rendering of the
  18-feature source dataset, horizontal trail names, approximation notice,
  location-off browsing and zoom controls observed.
  [Screenshot](../../docs/images/ios-simulator-trail-names.png).
- Relative file links and `git diff --check`: passed.

No native dependencies/configuration changed; no new native compilation was run.
Android native execution, field identity/alignment, every label at every zoom,
manual native permission denial, and persistent offline restart/retry remain
unverified. Permission-denial browsing is covered by the mobile regression test;
durable offline caching is not implemented by this change.
