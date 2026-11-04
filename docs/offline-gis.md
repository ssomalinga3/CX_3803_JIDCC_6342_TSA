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

## Current development API

The [public GIS handoff](../backend/GIS-HANDOFF.md) provides three synthetic
layers for rendering integration. They are not approved preserve datasets and
must not be used for trail navigation or off-trail warnings. The API implements
public reads and a 60-second HTTP freshness policy only; device caching,
offline persistence/restart and refresh UX remain mobile work under D-06.
