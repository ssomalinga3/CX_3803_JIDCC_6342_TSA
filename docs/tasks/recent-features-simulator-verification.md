# Recent feature audit and simulator verification handoff

## Assignment for the next agent

Verify the recently merged features on **both iOS and Android simulators**, fix
reproducible defects through focused draft PRs, and leave a complete evidence
matrix. The Android simulator setup is part of **your** assignment; the preceding
agent intentionally did not attempt it. You may use sub-agents as needed.

Start with `AGENTS.md`, `mobile/AGENTS.md`, [the specification index](../README.md),
[user flows](../design/user-flows.md), [security](../security.md), and
[decisions](../decisions.md). Preserve Jira ownership and other contributors'
changes. Proposed reporting/coverage decisions remain proposed after a code merge.

Verify current `main` first. Keep pending feature-branch testing separate. Do not
merge the remaining open feature PRs as part of this verification assignment.

## Audit scope and result

Audit window: **November 9, 2026 02:09:34 UTC through November 16, 2026
02:09:34 UTC** (the preceding seven days at final audit time). GitHub PRs updated since
November 8 were enumerated, and their merge metadata and submitted reviews were
read. Eleven PRs had merges in the window. Five of those also had approval reviews
in the window; no additional approved-but-open PR was found.
Approval here means a submitted GitHub `APPROVED` review, not an implicit
resolution of every client/product proposal.

The PR heads below are all ancestors of `main` commit
**`0cfeab11d1a769cce30ed5fc8432b6d3e74f4e73`**, the merge of
[#43](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/43). This is a
code-inclusion audit, not a claim of complete device acceptance.

| PR                                                                   | Feature / scope                                                 | Audited head | In audited main                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------- | ------------ | ------------------------------------------ |
| [#28](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/28) | Repeated GIS layer composition regression and acceptance guide  | `b703780`    | Yes                                        |
| [#29](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/29) | Original GIS files, integrity inventory and ingestion contracts | `b7ddea9`    | Yes                                        |
| [#30](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/30) | All 36 supplied trail segments and repeatable import            | `ef6a0a4`    | Yes, through #43                           |
| [#31](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/31) | Registered PDF context layers and reconciled landmarks          | `7fd3a3e`    | Yes, through #43                           |
| [#32](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/32) | Supplied DTM / USGS terrain, grouped elevation selector         | `bf978cd`    | Yes, through #43                           |
| [#33](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/33) | Proposed guest reporting / privacy / retry contract             | `ed078f5`    | Yes; proposal, not a working submission UI |
| [#35](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/35) | Persistent validated public GIS snapshots                       | `1d2637d`    | Yes                                        |
| [#36](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/36) | Internal private report persistence and replay handling         | `70018a3`    | Yes; no report HTTP routes                 |
| [#37](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/37) | Gated opt-in offline basemap prototype                          | `1efd056`    | Yes; disabled without an authorized style  |
| [#41](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/41) | Retain newer in-memory GIS through failed refreshes             | `3e588de`    | Yes                                        |
| [#43](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/43) | Land merged GIS ancestors and correct integration-test timing   | `81ded45`    | Yes                                        |

### Why the integration repair was necessary

#30 was merged into `gis/01-source-foundation`; #31 and #32 were merged into
`gis/02-official-trails`. Those parent-branch merges did not update `main`.
#43 brings their already-merged ancestry into `main`, preserving the offline,
reporting and cache-recovery work. The repair also gives database integration
tests 30 seconds while retaining the five-second unit-test limit: the PDF
multi-layer access test exceeded the former integration limit locally.

For future landings, confirm the stack trunk is `main`, then verify each diff
and its checks. Ordinary independent PR chains need their children retargeted
after each parent lands. Native GitHub stacks handle that automatically and
reject ordinary PR base edits; use the documented
[Stack API](https://docs.github.com/en/rest/pulls/stacks) when relinking an existing
stack. Native stack merges can include lower PRs as well, so do not use a merge
operation to repair stack metadata. A GitHub "Merged" badge alone does not prove
inclusion in `main`; inspect the target and ancestry.

### Pending features, deliberately outside main acceptance

At audit completion, #38 (signal observations), #39 (natural rendering order),
#40 (visibility presets), and #34 (hosted backend) remain open. Their branches
have been rebased and relinked onto repaired main as native GitHub stack #44 in this order:

`main → #38 → #39 → #40 → #34`

Re-read their live state before testing. Do not treat a pending feature as a
main regression or silently merge it to make a test pass. In particular, main
does not yet promise presets, the signal legend, or the newer ordering policy.

## Evidence already collected

For the #43 integration:

- `pnpm verify` passed: formatting, lint, types, **105 backend unit tests**, **120
  mobile tests**, and both platform JavaScript exports.
- A fresh disposable PostGIS database passed migrations twice, repeated selected
  imports, **all 131 backend tests**, and real Worker success/database-failure
  HTTP checks. Existing GIS data was not modified by this fresh-database runner.
- **27 GIS Python tests** and exact trail, PDF and terrain reproduction passed.
- All five checks passed on the PR head `81ded45`. Recheck CI on the final main
  SHA; PR-head evidence and main-push evidence are separate. The main-push run
  for `0cfeab1` also [passed all checks](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/actions/runs/43787385699).
- An existing iOS 26.3 development client rendered the real local Worker/PostGIS
  integration with location off: USGS **8 layers / 102 features**, Supplied DTM
  **8 / 98**. The source dropdown retained its selection and Done applied it.
- With the dedicated API stopped, app termination/restart retained **8 / 102**,
  terrain and the saved-data timestamp. Restarting the API and tapping Retry
  removed the saved-data notice and retained the live features.

Visual evidence: [online main integration](../images/ios26-main-gis-online.png)
and [cached restart with the API unavailable](../images/ios26-main-gis-cached.png).

The four open PRs also passed all five checks at their restacked heads:
#38 `6412eca`, #39 `3d41276`, #40 `509770f`, #34 `8371b2d`. The complete
preview stack passed `pnpm verify` (130 backend unit tests and 144 mobile tests),
the backend/Worker dry-run build and all 160 fresh-PostGIS backend tests. Those
checks do not merge the preview features into main or replace device acceptance.

Native compilation was not rerun. Android execution, fully disconnected startup
with embedded JavaScript, pack-download recovery, accessibility, measured device
performance and field alignment are **not** established by these checks.

## Work organization and isolation

One coordinator owns the findings matrix and integration decisions. Sub-agents
may divide work as follows, using separate persistent worktrees and branches:

1. **iOS:** primary iOS 26 simulator, device interactions, screenshots, permission
   states, cold restart, accessibility and visual defects.
2. **Android:** install/configure a supported emulator if necessary, rebuild the
   development client, and run the same matrix using Android back/permissions.
3. **Backend/data:** ancestry audit, source reproducibility, fresh PostGIS,
   privacy/replay tests, and shared-network/cache failure cases.

Do not have two agents control the same simulator. Coordinate before editing
shared map/state contracts; assign each fix to one worktree. Keep databases,
Metro/API ports and Worker test ports distinct. Backend Worker tests normally
use 18787/18788; serialize copies using those ports. Do not stop another agent's
server, migrate a shared/production database, or reset a simulator with unrelated
user state. Do not write to hosted Neon/Cloudflare resources to run local tests.

### Local resources left for this handoff

These are dedicated test resources, not production services. Inspect them before
reuse because another agent may have changed them since this record was written.

| Resource               | Location / purpose                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Main preview worktree  | `.work/pr-merged-gis-main`, branch `fix/land-merged-gis`; its `81ded45` tree matches audited main `0cfeab1`                                    |
| Local API              | `http://127.0.0.1:8797`, Worker inspector 9237; real local backend, public selected GIS only                                                   |
| Metro                  | `http://localhost:8092`, API configured to `http://127.0.0.1:8797/api/v1` for iOS                                                              |
| Dedicated PostGIS      | Docker container `cascade-pr43-smoke`, loopback port 55436, documented disposable local credentials; selected 9-layer/131-feature main dataset |
| iOS target             | Booted Cascade iOS 26 simulator, iOS 26.3; existing development client, location left off                                                      |
| Pending stack worktree | `.work/pr-final-stack`, branch `update/gis-stack`; isolated from the main preview                                                              |

The primary checkout has unrelated uncommitted documentation work. Do not switch
or reset it. Use a separate Metro instance/configuration for Android host
addressing. The temporary API proxy on 8796 was stopped. No Android setup was
performed for this handoff.

## Phase 1 — establish the exact target

1. Fetch remote state, record `origin/main` SHA, and inspect the working tree.
   For each audited head, run `git merge-base --is-ancestor HEAD_SHA origin/main`.
   Look for newer merged/approved PRs since this dated audit.
2. Create an isolated verification worktree from current main. Use Node from
   `.nvmrc`, root-pinned pnpm and the one root lockfile. Install at the root with
   `pnpm install --frozen-lockfile`.
3. Follow [mobile setup](../../mobile/README.md),
   [local startup](../development/local-startup.md), and
   [Android setup](../development/windows-android.md), adapting host prerequisites
   only after inspecting the actual machine. Android setup is your responsibility.
4. Verify the development client matches native modules/config. MapLibre needs
   a development build. Read version-matched Expo docs before API/native changes.
   Follow the repository's EAS/Xcode workflow; do not edit generated native files.
5. Use a dedicated local PostGIS database and the committed source import.
   Configure device-appropriate API addressing: iOS localhost and Android
   emulator host addressing are different. Never put backend credentials in the
   mobile configuration.
6. Record OS/runtime, device model, app build ID, source SHA, API SHA and data
   counts. Restart Metro and the app after branch changes; Fast Refresh can
   preserve incompatible hook state while a restack changes files.

## Phase 2 — automated gates

Discover scripts from manifests/runbooks, then run these documented gates in the
isolated checkout:

```sh
pnpm --dir backend cf:typegen
pnpm verify
pnpm --dir backend test:fresh
uv run --locked --project tools/gis python -m unittest discover -s tools/gis -p 'test_*.py'
uv run --locked --project tools/gis python tools/gis/convert_trails.py --check
uv run --locked --project tools/gis python tools/gis/convert_pdf_map.py --check
uv run --locked --project tools/gis python tools/gis/convert_terrain.py --check
git diff --check
```

Point `test:fresh` at a dedicated loopback database using the documented local
configuration. Inspect the current CI workflow for additional gates. Run the
actual native build separately; JavaScript exports and Jest mocks do not prove
native module compatibility or simulator acceptance.

## Phase 3 — run the same acceptance matrix on both platforms

| Area / PRs                    | Required device/backend checks and expected result                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sources / #29                 | Verify original hashes and locked conversion. Confirm development-only source tools/archives do not enter mobile/Worker bundles. No source registration result is a field-accuracy claim.                                                                                                                                                                                                                                                     |
| Trails / #30                  | Import all 36 supplied segments. Browse and zoom labels/casing; open details for width units, roughness and source identity. Missing difficulty remains absent. Replay import and legacy commands without duplicates or approximate-data regression.                                                                                                                                                                                          |
| PDF / #31                     | Verify preserve boundary, water, natural areas, roads/buildings, 22 reconciled landmark/source records and source attribution. Waterfall remains one physical marker; unresolved spring identity stays disclosed. Source HTML/media is inert. Context-only selected data has 7 layers/69 features.                                                                                                                                            |
| Terrain / #32                 | With the main catalog (9 layers/131 features), USGS shows 8/102, supplied shows 8/98, and elevation off shows 7/69. Only one source's bands/relief renders. Toggle, select, reopen, Done/Back, and retry without duplicates or camera jumps. Confirm source descriptions, dropdown/chevron behavior and asset/version mismatch handling.                                                                                                      |
| Layer regression / #28        | Exercise all single/pair/all-off/all-on subsets and repeat/reopen. Hidden records disappear from geometry, hit testing, counts and legend. Basemap/location controls remain usable. Check main's Done-apply/Back-cancel behavior, without assuming #40's immediate changes are merged.                                                                                                                                                        |
| Details                       | Open a trail, landmark and terrain band; verify correct fields, readable scrollable content, close/dismiss and no GPS request. Overlay hit priorities must match the currently merged specification. Check large text, VoiceOver/TalkBack, contrast and Android back.                                                                                                                                                                         |
| GIS cache / #35, #41          | Load online, terminate/restart with the API unavailable, retain the last complete dataset and saved timestamp. Reconnect/Retry and confirm replacement. Repeat failed/invalid/truncated refresh, corrupt slot, interrupted replacement, empty catalog and changed API origin. Verify a newer live snapshot is retained when disk saving fails or exceeds 4 MiB. A clean installation without cached data must report unavailability honestly. |
| Basemap prototype / #37       | Default configuration has no download action and keeps the online basemap. For pack testing, configure an authorized HTTPS style with permission for every tile/sprite/font source. Download the bounded zoom-13–16 preserve pack; measure bytes/duration; interrupt, resume the same pack, restart and remove it. Test out-of-coverage behavior and GIS overlays alongside it.                                                               |
| Location lifecycle regression | With location off/denied, map and layer controls still work. Then test permission denial, Settings recovery, missing/stale fix, recenter, tab/background cleanup and Android system back. Use synthetic simulator locations; keep device coordinates out of logs and GIS requests.                                                                                                                                                            |
| Reporting proposal / #33      | Check contract examples and documented unresolved decisions. Do not report report-capture/submission screens as delivered by this documentation PR.                                                                                                                                                                                                                                                                                           |
| Report persistence / #36      | Use real PostGIS tests for concurrent identical retries, same-owner conflict, cross-owner reuse, ordered private attachment references, rollback, immutable delivery mode/recipients and exclusion from public GIS. No report HTTP routes, uploads, notifications or full offline report queue are delivered by this PR; record those end-to-end paths as not implemented rather than claiming a device pass.                                 |

For map/cache cases, test iOS and Android with API-only failure first, then with
all networking disabled using an app containing embedded JavaScript. A Metro
development-client restart while Metro is reachable proves cached data recovery,
not a fully offline app launch. A warm native tile cache is not proof of a
downloaded basemap pack. Label those evidence levels separately.

### Offline prototype boundaries

The default public OpenFreeMap service is intentionally excluded from pack
downloads by this prototype. Do not bypass that gate or assume a style URL
authorizes all underlying resources. Coverage, refresh policy and a hard storage
budget remain proposed. Ask for a product decision if completing a fix requires
choosing them. The app may be fully functional as a gated prototype while those
production questions remain open; full #37 device acceptance still needs the
authorized test infrastructure and evidence above.

## Phase 4 — optional pending-stack verification

After main acceptance, test the latest pending stack in a separate worktree and
clearly label it as preview evidence. Consult each PR's current base and head.

- #38: preserve five source signal classes, their key/details and limitations;
  no invented dBm values, carrier information, coverage surface or live reading.
- #39: confirm relief/context below routes, intact POI markers/labels above
  strokes, device position above GIS and stable terrain insertion after all-off.
- #40: Visitor **3/59**, Staff **8/102**, Researcher **9/779** for the selected
  10-layer/808-feature catalog. Changes apply immediately; Done/native back retain
  them; manual overrides are session-only. Presets are public display choices,
  not access-control roles.
- #34: follow the hosted runbook, validate configuration and dry-run builds.
  Do not deploy or apply production migrations as a side effect of simulator
  verification. Server/storage credentials stay outside mobile bundles.

The inherited layer regression needs stable empty-source assertions starting at
#39 and the renamed Done action starting at #40. The current restack includes
those compatibility corrections at the respective PR boundaries.

## Phase 5 — fix PRs and completion criteria

For each reproducible defect, record the target SHA, platform/build, steps,
expected/actual behavior and screenshot or minimal trace. Distinguish a regression
from an explicitly unimplemented path or unresolved product decision.

Make one focused fix per root cause, add meaningful regression coverage, run
applicable gates, and repeat the failing native path on both platforms when the
fix affects both. Create **draft fix PRs** linked to the original PR and relevant
J6 issue, with before/after UI evidence and honest native/build limitations. Use
separate branches/worktrees for sub-agent fixes; the coordinator reviews shared
interfaces and verifies the combined result. Preserve other contributors' work.

Deliver a results table with one row per area and separate iOS/Android outcomes:
**Pass**, **Fail**, **Blocked**, **Not implemented**, or **Not run**. Include exact
SHAs, build/runtime IDs, evidence paths, fix PR links and remaining decisions.
Finish only when every audited area has an explicit outcome and every confirmed
defect has a fix PR or a concrete blocker. Do not equate green CI with all native
features being fully functional.
