# Off-trail indicator (J6-25, with J6-24 detection)

[J6-25](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-25) shows a friendly
reminder when a visitor appears to have left a marked trail.
[J6-24](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-24) supplies the
jitter-buffered on/off-trail detection it depends on. Numeric tolerances are
**Proposed** engineering defaults pending D-05; they are not safety approval.

## Behavior

- **Where it runs:** entirely on the device (`mobile/src/data/off-trail.ts`,
  `mobile/src/hooks/use-off-trail.ts`). Visitor coordinates are never sent,
  stored or logged. The only persisted value is a boolean "don't show again"
  preference (`off-trail-warning.json` in the app's document directory).
- **Geometry:** all published `feature_kind: trail` lines and `boundary`
  polygons in the full public snapshot (live or cached offline). Hiding layers
  in Choose GIS Layers does not disable the check.
- **Preserve gate:** fixes outside the boundary polygons report `unknown`, so
  visitors on nearby streets or at home are never told they left a trail. With
  no boundary published, only fixes within 150 m of a trail are evaluated.
- **Jitter buffer (Proposed):**

  | Setting              | Value | Purpose                                         |
  | -------------------- | ----- | ----------------------------------------------- |
  | Enter off-trail      | 20 m  | Distance from nearest trail centerline          |
  | Return on-trail      | 12 m  | Lower exit threshold (hysteresis band 12–20 m)  |
  | Maximum fix accuracy | 25 m  | Poorer or unknown-accuracy fixes keep the state |
  | Consecutive fixes    | 3     | ≈3 s at the 1 s watch interval, both directions |

  Distances use a local equirectangular projection, accurate well under a meter
  at preserve scale. Stale GPS hides the indicator without ending the current
  departure; turning location off or backgrounding resets it.

- **UI:** a non-blocking card below the map header. The map, controls, dock and
  all active layers stay usable. **Got it** is the large primary action and
  receives screen-reader focus; it closes the card until the visitor returns to
  a trail and leaves again. **Don't show again** is a quieter text button that
  stops the card on this device. While off-trail the dock also shows a subtle
  "Off trail" status line, independent of the card preference. The card yields
  to the feature-detail sheet.

## Tests

- `mobile/__tests__/off-trail.test.ts`: geometry extraction, known distances,
  preserve gate, single-fix jitter, hysteresis band, accuracy gate and a
  simulated walk (on trail → woods → back) using the supplied trail data.
- `mobile/__tests__/off-trail-warning.test.tsx`: map-screen integration for the
  card, focus, Got it re-arming, Don't show again persistence across restarts,
  outside-preserve silence, stale/off location, and unchanged displayed layers.
- Positions come from `mobile/__tests__/fixtures/off-trail.ts`, derived from
  the committed supplied geometry rather than hard-coded coordinates.

## Manual simulator check

With the local stack running ([local startup](local-startup.md)), allow
location in the app, then move the simulated GPS with
`xcrun simctl location <udid> set <lat>,<lon>` or the
[walking panel](macos-android.md#walk-with-spoofed-gps). Known supplied-data
positions: on trail `33.7175748,-84.4796884`; about 40 m off trail inside the
preserve `33.7178406,-84.4791350`. Hold the off-trail position for at least
3 seconds.

## Verification record — November 19, 2026

Full stack on `Cascade iOS 26` (iPhone 17, iOS 26.3), existing EAS development
client, Metro 8083, local Worker 8789, Docker PostGIS 55436 with
`db:seed`, `db:import:source`, `db:import:trails` and `db:import:boundary`.
Simulated GPS was moved with `xcrun simctl location` in ~2 m steps.

| Check                                                  | Result                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| On trail after enabling location                       | No card, no status line                                                  |
| Walk ~40 m off trail                                   | Card appeared after confirmation; dock shows "Off trail"                 |
| Map controls                                           | Card clears the right-hand control column; map stays interactive         |
| Got it                                                 | Card closed; dock status line remained                                   |
| Back on trail, then off again                          | Card returned                                                            |
| Don't show again, then app relaunch and off-trail walk | No card; status line only; preference file `{"version":1,"hidden":true}` |

![Off-trail reminder on iOS 26](../images/j6-25-off-trail-warning-ios26.png)

Not verified: VoiceOver focus landing on **Got it** on a device (covered by a
Jest test only), Android, physical-device GPS accuracy, and field tolerance
tuning (D-05).

React Compiler is enabled in the app but not in Jest. The hook therefore keys its
render-phase state on the stable input collection rather than derived geometry,
whose identity is not stable across compiler re-renders.
