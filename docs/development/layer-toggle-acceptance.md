# Layer-toggle verification (J6-21)

[J6-21](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-21) covers single and
combined toggling, duplicates, speed and visual clarity. The
[J6-19 implementation record](layer-selection.md) retains the earlier iOS
smoke evidence. This record adds client-to-component regression coverage;
it does not establish native rendering performance or complete J6-21.

## Automated regression

Run from the workspace root with the pinned Node and pnpm versions:

```sh
pnpm --dir mobile test --runInBand layer-selection-integration
pnpm --dir mobile typecheck
pnpm --dir mobile lint
pnpm --dir mobile test:ci
```

The [integration test](../../mobile/__tests__/layer-selection-integration.test.tsx)
uses the real `loadPublicGis`, `usePublicGis`, provider, chooser and map component.
Fetch responses and native MapLibre/device APIs are mocked. The fixture has
three layers and four features: two sections of Terrace Trail, one landmark and
one boundary. Each layer deliberately reuses the raw feature ID `shared`.
This tests the client's layer-scoped identity contract as well as legend
deduplication. The fixture's pillar is test metadata, not a production assignment.

| Visible layers       | Feature count | Terrace legend entries |
| -------------------- | ------------- | ---------------------- |
| None                 | 0             | 0                      |
| Trails               | 2             | 1                      |
| Landmarks            | 1             | 0                      |
| Boundary             | 1             | 0                      |
| Trails + landmarks   | 3             | 1                      |
| Trails + boundary    | 3             | 1                      |
| Landmarks + boundary | 2             | 0                      |
| All                  | 4             | 1                      |

Every combination is applied, reopened and repeated in reverse order, ending
with all layers restored. Assertions cover exact render-source IDs, no duplicate
features, visible versus hidden detail hits, independent stored choices and one
legend entry per trail. All-off removes the GIS source while keeping basemap
zoom available. The entire sequence must make exactly four fetch calls: one
catalog and one collection per layer. Toggles, details and reopening must not
request location, start a GPS watcher, move the camera or mutate API payloads.

The test permits 15 seconds for the full interaction sequence, including the
testing library's simulated press delays. This is a test-runner timeout, **not a
product performance budget**. Wall-clock Jest duration cannot measure native
MapLibre rendering or device frame rate.

### Verification — November 9, 2026

On Node 24.21.0 and pnpm 10.26.2, mobile lint, typecheck and all **92 tests**
passed (16 suites), including the new repeated-combination integration test.
Verification ran in an isolated worktree based on `main` at `45a4ccd`.
No application source, dependency or native configuration changed in this slice.
Native compilation, iOS/Android execution, bundle exports and device timing were
not rerun. Existing uncommitted map/GPS work was preserved in the original
workspace and is excluded from this PR's changes and verification results.

## Remaining native acceptance

Use the [local startup guide](local-startup.md) or
[Windows/Android guide](windows-android.md). Record build/commit, OS/device,
catalog IDs, feature counts and whether demo layers are included. Repeat these
checks on iOS and a supported Android target:

1. Apply each single layer, each pair, all-off and all-on. Repeat the sequence
   and reopen the chooser; confirm the applied switches, counts, detail hits
   and legend match the displayed data. Preserve the original viewport.
2. Pan and zoom through overlapping features. Check that boundary fills and
   landmarks do not obscure trail strokes, Gateway's white strokes retain
   visible casing, and labels/legend remain readable. Check unnamed dashed
   connections and verify restored layers appear once.
3. Repeat with large text and VoiceOver/TalkBack. Verify switch names/states,
   Done and cancellation, scrolling, and usable map controls with all layers off.
4. Record apply-to-visible-update latency, frame stalls and memory behavior
   over repeated cycles for the current catalog and a documented larger public
   test dataset. Capture the measurement method and observed values; agree a
   numeric budget under D-10 before claiming a performance pass.

API request counts in the automated test cover GIS fetches only. They do not
measure native basemap tile traffic. Persistent offline restart, approved
production pillar mappings and trail-safety alignment remain separate work in
[D-05/D-06/D-10](../decisions.md). No report persistence, retry or authorization
behavior changes in this verification slice.
