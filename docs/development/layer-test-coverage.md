# J6-21: layer test coverage and remaining acceptance

[J6-21](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-21) requires single and
combined toggling checks for speed, duplicates and visual clarity. Its drawer
dependency, [J6-19](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-19), is not
implemented on the main baseline used for these tests. This coverage exercises
the existing shared GIS loader as groundwork; it does not complete toggle
acceptance or change application behavior.

Run from the repository root:

```sh
pnpm --dir mobile test --ci --runInBand --runTestsByPath __tests__/gis-layer-composition.test.ts __tests__/gis.test.ts __tests__/use-public-gis.test.ts
```

The new composition suite uses synthetic, in-memory HTTP fixtures and verifies:

- Both feature requests start before the slow first layer completes. Each layer
  is requested once and out-of-order responses retain the correct feature/layer
  association, unique renderer IDs, geometry and combined bounds.
- The same local feature ID in distinct layers remains distinct, without
  modifying the response fixtures' original IDs.
- Empty layers remain in the catalog without contributing phantom features,
  identity entries or bounds.
- Duplicate catalog rows fail before feature requests; duplicates within a
  collection or an HTTP failure reject the entire combined snapshot.

Existing suites separately cover single-layer loading, malformed geometry/URLs,
ambiguous composite identities, retry, cancellation and stale endpoint responses.
These tests run in the existing mobile Jest CI job with mocked network access.
Request concurrency is a deterministic scheduling check, not a latency benchmark
or evidence of native rendering speed.

## Still pending for J6-21

After J6-19 lands, exercise individual rows, combinations, rapid repeated
toggles, all-off/restore and map return through the real drawer. Check that
sources/features are not duplicated, trail ordering is preserved, selected
feature details stay consistent with visibility, and descriptions/legend remain
readable. Verify on iOS and supported Android targets. Use approved layer/domain
fixtures and agree on a performance threshold/device matrix before reporting
speed acceptance; do not invent a millisecond target in Jest. See the
[user flows](../design/user-flows.md) and [open decisions](../decisions.md).

The current supplied/approximate map is not approved preserve/protective boundary
data. These tests do not establish GPS accuracy, on/off-trail safety, offline
coverage or the pending J6-12/J6-24 data/policy requirements. No Jira status change
is implied by this test slice.
