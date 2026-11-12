# GIS data and offline operation

Baseline: S1 pp. 10–12; S2 R-02, R-06, R-07; S3 stories 1–5 and 9. Offline functionality is planned, while its coverage and storage budget remain subject to field measurements.

Use the existing [offline-availability screen](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-245) and [queued-report screen](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-249) for presentation: waiting-to-send status, retained report/photos, automatic-send explanation, Check connection, and Edit draft. Trail behavior is tracked in [J6-23](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-23), [J6-24](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-24), and [J6-25](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-25), with geometry verification in [J6-26](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-26).

## GIS preparation and rendering

The client supplies preserve GIS datasets. Import trail centerlines, trail/protective boundaries, preserve boundaries, and landmarks into PostGIS with SRID 4326; retain non-spatial attributes in `gis_feature.properties`. Validate source CRS and geometry alignment before publishing.

S2 explicitly names Trails ATL, sewer, and stream-buffer layers with 25 ft and 75 ft administrative zones. The full catalog, pillar assignments, provenance, and public/private classifications still need client confirmation. Do not interpret these zone labels as verified legal requirements or calculate buffers in latitude/longitude degrees; agree on source data and spatial processing in D-05.

Serve GeoJSON for layer features and vector tiles for larger datasets. Render public layers on one native map with trails remaining legible when layers overlap. Keep historical points in the normal layer system. In the optional 3D view, display trails and terrain only, per S1; historical-temperature time selection is a separate stretch feature dependent on the Georgia Tech study dataset.

Off-trail indication must work with trail boundaries and a buffer against GPS jitter/flickering, as J6-24 specifies. The numeric tolerance and where that calculation runs are open. Any chosen approach must preserve planned offline navigation and location privacy.

## Minimum planned offline behavior

| Data/action | Expected behavior |
| --- | --- |
| Previously cached base map and trails | Remain usable without cellular service |
| Additional GeoJSON/tile layers | Use locally available data; full cache coverage is not yet defined |
| Emergency reference information | Available locally for the safety screen |
| GPS position | Use device permission and an available location fix; distinguish missing/stale location from missing network |
| Photo report capture | Store metadata and photos durably on the device, visibly pending |
| Report upload | Resume automatically on reconnect without lost or duplicate observations |
| GIS refresh | Refresh local data from the server when connectivity returns |

Do not imply that a first launch without downloaded data has a complete map. Proposed UX: show which content is available offline and preserve the last complete cache if a refresh fails. Offline 3D terrain and full historical-image downloads are not established requirements.

## Proposed queue contract

The queue needs persistent submission identity, account/guest ownership context, metadata, delivery mode and explicit custom recipients, local photo references, attempt state, and the accepted server ID. Proposed states are `draft`, `pending`, `uploading`, `accepted`, and `needs_attention`; these are local delivery states, separate from administrative statuses such as Submitted or Resolved.

- Move an explicitly submitted offline report to `pending` only after metadata and photo files are stored durably.
- After a restart, recover interrupted uploads as retryable without changing their submission identity.
- Preserve queued data on network failure. Mark acceptance only after a server acknowledgement, including an identical-retry acknowledgement after a lost response.
- Keep invalid reports available for correction. Account submissions may need renewed authentication, but guest reporting/sync must not require account creation or sign-in (S8). Do not continuously retry permanent validation errors.
- Preserve custom-recipient privacy across app restarts, reconnects, and delivery failures. Do not apply category-default park routing to a queued custom report; park administrators cannot access the report after sync (S8).
- Resolve server deduplication, notification retry tracking, queue retention, and device storage limits in D-06/D-07/D-09 before implementation.

## Acceptance checks

With maps preloaded, disable networking and verify pan/zoom, trail visibility, and available GPS navigation. Capture and submit an offline report, restart the app, and verify the report and photos remain pending. Reconnect and interrupt an upload; retry it and verify exactly one observation is accepted. Confirm offline/pending indicators, local safety reference access, and that failed refreshes do not erase usable map data. Measure rendering and storage on the agreed target devices; numeric performance budgets remain open.

## Saved public GIS overlays (J6-35)

On Android and iOS, the app saves a complete, validated public GIS response in
app-private storage. The cache is scoped to the configured API URL and retains
feature IDs, source metadata, and demo flags. It alternates between two files,
each capped at 4 MiB, so a failed or interrupted write can leave the previous
complete copy available.

On startup the app can show the saved overlays and the save time while it
refreshes. A failed refresh keeps the saved copy visible and offers Retry. An
installation with no saved data still needs a successful GIS request.

For device verification, open the map once with the GIS API reachable, fully
quit the app, make the API unreachable, and reopen. Check the saved-data notice,
layer visibility, and feature details. Reconnect and use Retry to verify
replacement. Use a build with embedded JavaScript when testing a cold restart
with all networking disabled.

## Basemap download prototype

An Android or iOS test build can set `EXPO_PUBLIC_OFFLINE_MAP_STYLE_URL` to an
HTTPS style on a self-hosted or explicitly approved service. Confirm permission
for every source referenced by the style, including tile sets, sprites and
fonts. Use a versioned URL without credentials. The map and offline pack use
the same style. With no configured style, the existing public basemap is used
for online browsing and no download action is shown.

[OpenFreeMap's public service](https://openfreemap.org/tos/) sets a per-download
tile or byte limit, requires at most four parallel requests, and requires an
app-specific User-Agent. The pinned MapLibre React Native offline manager
doesn't expose parallelism or User-Agent controls in its pack API. Keep the
prototype pointed at authorized test infrastructure.

The prototype saves a single rectangular preserve-area pack at zoom levels
13–16. The box is a test viewport, and coverage, storage budget and refresh
policy still need review. The pinned MapLibre dependency already exposes the
offline manager on Android and iOS. Use a compatible development build for
online setup and a build with embedded JavaScript for a fully offline restart.

1. With the public GIS API and approved style reachable, load the Map screen.
2. Open **Choose GIS Layers** and use **Download preserve basemap**. Wait for
   the saved message. Interrupt a second trial and check that **Resume download**
   reuses the same pack.
3. Disable networking, force quit, and reopen the build. Check that the
   preserve basemap and saved GIS overlays are visible within the downloaded
   region, that feature details still open, and that the saved-data notice
   remains visible. Verify a clean installation separately.
4. Repeat on Android and iOS. Record device/build, download duration, tile and
   resource counts, storage before and after, and out-of-coverage behavior.
   Use **Remove saved basemap** to release the test pack when finished.

## Current development API

The [public GIS handoff](../backend/GIS-HANDOFF.md) provides three synthetic
layers for rendering integration. They are not approved preserve datasets and
must not be used for trail navigation or off-trail warnings. The API implements
public reads and a 60-second HTTP freshness policy only; device caching,
offline persistence/restart and refresh UX remain mobile work under D-06.

## Supplied source snapshot (November 4, 2026)

The [Cascade Springs dataset](../data/cascade-springs/README.md) adds one sourced
trail and eight landmarks through an explicit `db:import:source` command. It uses
the existing public read API and native renderer. Demo fixtures remain optional
and separate. The source has no polygon boundaries and is not approved trail
safety data. This import adds no offline persistence, caching or queue behavior.

The [full-network reference](design/trail-network.md) records the later park-sign
target and a catalog marked awaiting GIS. It defines the expected geometry and
attribute families without importing guessed geometry or changing offline scope.
