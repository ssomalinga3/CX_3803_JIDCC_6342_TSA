# Public GIS mobile handoff

From the workspace root (Docker running):

```bash
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm backend:setup                 # starts PostGIS, generates types, applies migrations
pnpm --dir backend db:seed          # synthetic fixtures, safe to repeat
pnpm backend:dev
```

Existing installs can apply schema updates with `pnpm --dir backend db:migrate`.
The backend API base URL is **http://localhost:8787/api/v1**. Use the local
Worker, not the optional Node scaffold, for the database-backed API.

For a physical device, run `pnpm backend:dev --ip 0.0.0.0` and use
`http://<laptop-LAN-IP>:8787/api/v1` on the same trusted Wi-Fi network. For example,
if your laptop address is `192.168.1.25`, the catalog URL is
`http://192.168.1.25:8787/api/v1/layers`. Check the laptop network settings and
firewall; `localhost` on a phone addresses the phone. Android Emulator normally
reaches the host through `10.0.2.2`; iOS Simulator can use `localhost`.
Local HTTP/native transport configuration is a mobile development concern;
production requires HTTPS. No mobile UI/configuration is changed by this PR.

## Fixtures and initial viewport

These are **synthetic development shapes**, not authoritative Cascade Springs
preserve data, legal boundaries, historical facts, or navigation guidance.
No approved GIS datasets were present in the repository. Metadata includes
`isDemo: true`, a warning description, and `source: "Repository synthetic demo fixtures v1"`.
Feature properties also include `isDemo: true`. Production data ingestion and
pillar mappings remain open under D-05; demo `pillar` is `null`.

| Stable layer ID   | Geometry type | Feature count | Features URL                                                   |
| ----------------- | ------------- | ------------- | -------------------------------------------------------------- |
| `demo-trails`     | LineString    | 2             | `http://localhost:8787/api/v1/layers/demo-trails/features`     |
| `demo-boundaries` | Polygon       | 1             | `http://localhost:8787/api/v1/layers/demo-boundaries/features` |
| `demo-landmarks`  | Point         | 2             | `http://localhost:8787/api/v1/layers/demo-landmarks/features`  |

Combined extent `[west,south,east,north]`: **[-84.482,33.718,-84.474,33.726]**.
Suggested map center `[longitude,latitude]`: **[-84.478,33.722]**. Fit that extent
to see all three layers. Demo trail properties illustrate `surface_type` as
`durable` or `natural`; they do not establish a production property schema.
The transactional seed upserts stable IDs, so reruns restore these fixtures
without duplicating rows. It does not delete other layers or features. Run it
only against a development database.

## Requests and contracts

```bash
curl http://localhost:8787/api/v1/layers
curl http://localhost:8787/api/v1/layers/demo-landmarks/features
curl 'http://localhost:8787/api/v1/layers/demo-landmarks/features?bbox=-84.481,33.719,-84.479,33.721'
```

The catalog response is `{ "layers": [...] }`. One complete entry is:

```json
{
  "layerId": "demo-landmarks",
  "name": "Synthetic demo landmarks",
  "description": "Synthetic development fixture. Not authoritative preserve data; do not use for navigation.",
  "layerType": "landmark",
  "pillar": null,
  "source": "Repository synthetic demo fixtures v1",
  "isDemo": true,
  "featuresUrl": "/api/v1/layers/demo-landmarks/features"
}
```

Resolve `featuresUrl` against the server origin (`http://localhost:8787`), not
against the `/api/v1` base path. Layer and feature identifiers are strings.
Catalogs and collections are sorted by their identifiers. TypeScript response
contracts are exported from [types.ts](src/modules/gis/types.ts), which has no
database/runtime imports and can be consumed by the mobile team.

The bbox request above returns this complete GeoJSON response, served as
`application/geo+json`:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "demo-landmark-1",
      "geometry": { "type": "Point", "coordinates": [-84.48, 33.72] },
      "properties": { "name": "Demo trailhead", "isDemo": true }
    }
  ]
}
```

Coordinates are always longitude then latitude (SRID 4326). Omit `bbox` to
receive all features in a public layer. Bbox uses exact intersection, includes
edge touches, and returns complete geometries without clipping. Values must be
four finite decimals in longitude/latitude bounds, with west < east and south <
north. Antimeridian wrapping, zero-area and repeated bbox parameters are rejected.
An empty public layer or a viewport with no matches returns `200` with
`{"type":"FeatureCollection","features":[]}`. There is no pagination or other
filter support in this development slice; large datasets need a later strategy.

Unknown and non-public layers both return:

```json
{
  "error": { "code": "NOT_FOUND", "message": "Resource not found", "fields": {} }
}
```

Malformed bbox returns `400 INVALID_BBOX` with a `fields.bbox` explanation.
Database failures return `503 DATABASE_UNAVAILABLE` with a generic message.
The public catalog never includes non-public layers. No visitor location or
permission is needed by either endpoint.

Successful responses use `Cache-Control: public, max-age=60`; errors use
`no-store`. Public content can remain cached for 60 seconds after changes,
including a switch to private. Publish only data suitable for that policy.
There is no application cache or custom validator. Hyperdrive SQL caching
remains disabled; local connections bypass actual Hyperdrive pooling/caching.

## Verification

After setup and seed, from the workspace root:

```bash
pnpm --dir backend test:integration  # Jest with real PostGIS (also runs unit tests)
pnpm backend:check                  # DB readiness, Worker bundle and real Worker HTTP tests
pnpm --dir backend test:fresh       # creates/removes an isolated local test database
pnpm backend:build                 # separate Node TypeScript build
pnpm verify                        # existing format/lint/type/Jest/mobile bundle checks
```

The ordinary Jest command skips database integration tests unless
`GIS_INTEGRATION=1`; `test:integration` enables them explicitly. CI runs them
in the backend-local job after migration and seeding against its fresh Docker
database. Worker checks use ports 18787/18788, verify public reads, private/unknown
404s, bbox behavior and redacted failures, then stop their Workers. Integration
tests temporarily insert `test-gis-*` / `test-worker-*` fixtures and remove them;
run against a development database, with one suite at a time.

`test:fresh` accepts only a loopback database connection, requires local database
creation privileges, and verifies initial/replayed migrations, repeated seeds,
Jest integration and real Worker requests in a new disposable database. Existing
development data is preserved. No cloud resources or deployment is involved.
Mobile rendering, iOS/Android device behavior, permission denial and offline
restart/retry are separate verification owned by the mobile work.
