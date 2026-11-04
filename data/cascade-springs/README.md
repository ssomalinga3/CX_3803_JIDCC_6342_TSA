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
