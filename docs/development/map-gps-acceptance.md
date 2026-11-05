# Updated map and GPS acceptance — November 4, 2026

Related: [J6-14](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-14),
[J6-15](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-15),
[J6-16](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-16).
This record supplements the [GPS checklist](../../mobile/README.md#acceptance-checks)
and [local startup runbook](local-startup.md).

## Checkout and local stack

Updated from main `e94ea10`, including PRs #9–#12, on
`fix/local-map-acceptance`. The branch adds the source-test filesystem-path fix
and the services-off feedback correction described below. Node 24.21.0 and
pnpm 10.26.2; existing iPhone 17 Pro / iOS 26.3 development client with ExpoLocation.
No new native compilation or installation was performed.

Re-imported with `COMPOSE_PROJECT_NAME=cascade-springs-local CASCADE_DB_PORT=55434
pnpm --dir backend db:import:source`. The two source layers now contain ten trail
sections and eight landmarks. The existing three demo layers/five features were
retained, so the running map reports **Demo GIS · 5 layers · 23 features** and
keeps both synthetic-data and approximate-name notices visible. Source fixtures
are not approved navigation data.

PostGIS uses port 55434, Worker 8787 and Metro 8082. Fast Refresh across the merged
map-layer change initially raised an immutable-layer-ID error. Terminating and
reopening the installed app against Metro cleared it; cold launch rendered the
updated route labels and approximation notice. Native dependencies/configuration
did not change in PRs #11/#12.

## Observed iOS acceptance

| Path                        | Result and practical limit                                                                                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Location off                | Cold launch browses the map without an automatic location prompt; recenter is disabled.                                                                                                                                                                                                                                   |
| Explicit consent and denial | Use my location opens the native foreground explanation; Don't Allow produces the Settings fallback while GIS and zoom controls remain available.                                                                                                                                                                         |
| Settings recovery           | Navigated Settings → Privacy & Security → Location Services → Cascade Springs Smart GIS; selected While Using the App and returned. Where iOS restarted the app, tapped Use my location again. A fresh simulated fix appeared without another permission prompt.                                                          |
| Simulated GPS/recenter      | Ran a 1 m/s route using checked-in public source positions. Blue dot, approximately 5 m reported accuracy and padded recenter were visible. This does not establish physical-device accuracy.                                                                                                                             |
| Stale fix                   | Cleared the simulated route. Out-of-date feedback appeared and recenter became disabled; restoring simulation restored a fresh fix.                                                                                                                                                                                       |
| Background/resume           | Simulator Home → app icon returned to a fresh position without another prompt. This checks visible recovery; automated tests separately cover watcher cleanup and late callbacks.                                                                                                                                         |
| Map/Explore return          | Deep-linked to Explore and back to Map. No new consent prompt; location state recovered. Direct native tab tapping is separate.                                                                                                                                                                                           |
| Approximate access          | Turned Precise Location off in iOS Settings. App showed the position with about 3528 m reported accuracy; restored precise access afterward.                                                                                                                                                                              |
| Services off                | Turning off global iOS Location Services exposed the message-order bug below. After correction, the same state shows “Device location services are off. You can still browse the map.” with recenter disabled. Restored services afterward.                                                                               |
| Permission revoked          | Set app access to Never, returned to Map and observed Settings fallback with recenter disabled. Restored While Using and precise access afterward.                                                                                                                                                                        |
| GIS API outage/retry        | Stopped only the local Worker, cold-launched app, saw GIS unavailable/Retry while online basemap controls stayed available. Enabled GPS and observed a fresh dot/accuracy despite the API outage. Restarted Worker and tapped Retry; all 23 features returned. This is an API outage, not a network-disabled device test. |

## Corrections and automated verification

- The source snapshot test passed a URL `.pathname` containing `%20` to Python.
  `fileURLToPath` now supplies the actual filesystem path for this checkout's
  directories with spaces. The existing conversion test verifies the correction.
- iOS reports app permission as denied when global Location Services are off.
  Checking permission first incorrectly showed the blocked-permission message.
  The hook now checks device services before requesting/checking app permission,
  after explicit map-location opt-in. It does not start a watcher or prompt while
  services are disabled. The denied-plus-services-off regression failed before
  this correction and passed afterward, alongside the granted-permission case.
  API reference: [Expo SDK 57 Location](https://docs.expo.dev/versions/v57.0.0/sdk/location/#locationhasservicesenabledasync).
- `pnpm verify` passed after the correction: formatting, workspace lint/types,
  backend/mobile Jest and iOS/Android JavaScript bundle exports. JavaScript exports
  do not establish Android native execution or new native compilation.
- `COMPOSE_PROJECT_NAME=cascade-springs-local CASCADE_DB_PORT=55434 pnpm --dir
backend test:fresh` passed: all 50 backend tests, repeated migrations/imports,
  stale cleanup/rollback, real Worker HTTP/access/bbox checks, database failure
  and liveness. This suite ran after updating/importing PRs #11/#12; the later
  location-hook-only correction does not change database or Worker behavior.

The [updated map screenshot](../images/ios-map-acceptance.png) shows named route
sections, 23 features, the approximation notice and a stale fix with recenter
disabled. Blue landmark markers remain independent of the expired visitor dot.

## Remaining acceptance

Native pan/pinch and camera independence during manual panning remain unverified:
the automation tool's drag operation failed with `noWindowsAvailable`. A manual
check was requested. Buttons and accessibility actions worked, but cannot stand
in for map gestures. No frame-rate/latency budget has been agreed or measured.

Full device-network disable/uncached basemap behavior, physical-device GPS and
large-text layouts remain unverified. The tab-bar regression in PR #12 targets
classic iOS; this run used iOS 26.3, so its existing iOS 18.6 PR evidence remains
separate. Android native acceptance was not performed; the emulator was briefly
booted to inspect availability, no project client was installed, and it was shut
down at the user's request to keep this run focused on iOS.

Durable offline downloads/restart/retry, off-trail safety, and server request-error
redaction are separate unfinished work. J6-14/J6-16 cannot be described as fully
accepted based on this record alone.
