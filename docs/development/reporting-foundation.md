# Reporting foundation review (J6-27 / J6-28)

Reviewed November 16, 2026, starting from `c575693`. The live
[J6-27](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-27) and
[J6-28](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-28) tickets were New
and unassigned at review time. This document records repository evidence; it
does not change Jira status or approve product choices.

## J6-27 decision review

The [reporting contract](../reporting-contract.md) is partially approved. Guest
submission without sign-in and exclusion of custom reports from park staff are
confirmed requirements. The following choices still need explicit resolution
in [the decision register](../decisions.md):

| Decision | Concrete proposal or missing input                                                                                                                                                                                    | Review status                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| D-01     | Per-report UUID and separate 256-bit guest secret in secure device storage; digest on server; original-installation access only, without cross-device recovery                                                        | Approved by owner November 16, 2026                                                                              |
| D-03     | Explicit reviewed custom recipients; separate notification per recipient; no park fallback. Park category IDs, destination addresses, recipient verification and media-access rules need approved configuration       | Production configuration and remaining rules open                                                                |
| D-04     | Require 1–3 JPEG/PNG photos, 5 MiB each, 16 MiB request, 4,096 pixels per edge, 12 million decoded pixels; convert unsupported formats on device; strip metadata on server; allow missing GPS with an explicit reason | Approved by owner November 16, 2026                                                                              |
| D-07     | Identical authorized replay returns the original receipt; conflicting reuse is rejected; upload reservation/lease and notification work commit safely; ambiguous provider acknowledgements require reconciliation     | Full acceptance/retry contract remains proposed; numerical retry and lease bounds still open                     |
| D-09     | App-private drafts/photos and secure secrets excluded from backups; retain pending work until acceptance or explicit deletion; release queued photo copies after confirmed receipt                                    | Storage protection, retention periods, deletion, backup and operational logging policies still need confirmation |

Approval covers the D-01 guest-access and D-04 capture policies above; other
choices remain open. Cross-device recovery is tracked in
[J6-71](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-71). Do not enable a
submission route or infer production destinations from Figma examples. The
submission API must not use the persistence helper as a complete acceptance
workflow: it still needs input validation, ownership proof verification,
private uploads and durable notification work. Media delivery remains behind
the private S3 adapter and email behind the SES adapter under the current stack.

## J6-28 implementation and acceptance evidence

Migration `0002_report-persistence` already exists on main. Preserve that applied
migration. Its model and `acceptObservation` provide the internal persistence
foundation; no replacement schema or duplicate migration is needed for this review.

| Acceptance area      | Current evidence                                                                                                                                                                                                                                               | Boundary                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Minimum report model | Observation UUID, globally unique submission UUID, account ID or guest-secret digest, request digest, capture/acceptance times, point or missing-location reason, category ID, note, delivery mode and effective recipients; ordered stable private image keys | Category/routing catalogs, staff workflow status and notification state are separate work                 |
| Atomic persistence   | Observation and image references commit together; duplicate image reference failure rolls back the observation and allows a clean retry                                                                                                                        | Actual object uploads and upload leases are J6-29/30                                                      |
| Concurrent replay    | Same-owner identical concurrent requests produce one created result and one replay with the same receipt                                                                                                                                                       | The caller must supply a digest of normalized metadata and ordered upload hashes                          |
| Owner isolation      | Guest/account mismatches and competing different guests cannot retrieve a receipt or overwrite the winning report; changed payload digest returns conflict                                                                                                     | This helper consumes verified internal ownership context; it does not authenticate HTTP callers           |
| Durable routing      | Accepted destination, capture time and original object references remain unchanged by an identical replay after routing configuration changes                                                                                                                  | Custom-recipient email delivery and staff endpoint exclusions need their own tests when those paths exist |
| Database invariants  | Tests reject missing/both owners, malformed digests, unexplained missing location, unknown reason/mode, empty recipients and multiple park recipients                                                                                                          | Image decoding, email syntax and approved product limits belong at the validated submission boundary      |
| Public GIS isolation | Before/after catalog comparison and requests to every public feature collection exclude the private report marker, submission identity and recipient address                                                                                                   | No report detail, staff, export or media endpoint is registered yet                                       |
| Migration safety     | Use the existing disposable-database runner for fresh migration, migration replay, repeated seed/import, PostGIS integration and Worker checks                                                                                                                 | Never run this against the hosted database                                                                |

## Reproduce verification

Use the pinned Node/pnpm versions from the workspace root and the same local
database configuration as the running Worker. The example port below follows
the [local startup runbook](local-startup.md).

```sh
nvm use
export COMPOSE_PROJECT_NAME=cascade-springs-local
export CASCADE_DB_PORT=55434
pnpm --dir backend test:integration observations.test.ts
pnpm --dir backend lint
pnpm --dir backend typecheck
pnpm --dir backend build
pnpm --dir backend test:fresh
git diff --check
```

`test:fresh` creates and removes a separate temporary database on the local
PostgreSQL instance, including cleanup on failure. Its Worker checks use ports
18787/18788; keep those free. The normal database and its GIS data remain in place.

These checks establish persistence and server behavior, not native report
capture, camera/location denial in reporting, offline draft restart/sync,
S3 access expiry, SES delivery, or staff authorization. Those acceptance paths
belong to the dependent reporting tickets and must not be reported as passing
on the basis of this foundation review.

## November 16 verification results

Node 24.21.0 / pnpm 10.26.2, local Docker PostGIS on port 55434:

- Reporting integration: all 17 cases passed (four existing cases plus 13 new
  cases, with the public-GIS isolation case expanded to every public layer).
- Backend lint, typecheck and TypeScript build passed.
- `test:fresh` passed: migrations applied to a new temporary database and replayed,
  repeated fixture/source imports completed, all 14 backend suites / 173 tests
  passed, and real Worker HTTP/database and unavailable-database checks passed.
- No production resources, remote database, applied migration, or application
  runtime behavior changed in this review.

The simulator was reconnected to the merged `c575693` checkout through Metro on
8082, with the normal local Worker on 8787. This is startup evidence only and
does not add native reporting acceptance evidence. J6-27 guest-access and capture choices were subsequently approved; remaining
contract decisions are still open; J6-28 has verified persistence evidence but retains
that dependency. Neither Jira ticket was changed or marked complete.
