# Open decisions and source reconciliation

The sources settle the main stack and feature direction, but do not settle the choices below. This register prevents implementation guesses from being mistaken for client decisions. Suggested decision participants are responsibilities, not assignments to named people.

| ID | Decision to record | Evidence / conflict and implementation impact | Participants |
| --- | --- | --- | --- |
| D-01 | Authentication/session implementation, optional accounts, guest ownership/recovery mechanism | **Guest reporting confirmed by S8.** Account creation/sign-in cannot be required to capture, submit, or sync a guest report. Define secure guest report access and retry ownership; keep staff authentication required. | Team |
| D-02 | Remaining role/action matrix, staff UI platform, personal history/follow-ups, status transitions/export format | **Custom-recipient reports hidden from park administrators, confirmed by S8.** Enforce this across staff lists, details, media, exports, notifications, and mutations. Staff roles cannot override this boundary. Public visibility of ordinary park-routed reports and guest history recovery remain open. | Client + team |
| D-03 | Production category/recipient configuration, recipient verification, and multiple-recipient schema | S6 already designs custom reporting to one or more listed email addresses with review/validation screens; this UI choice is established. S1 only models one assigned recipient. Resolve persistence, authorization, and delivery semantics without removing the existing custom-recipient flow. Prototype destination names are examples, not confirmed production routing. | Client + backend |
| D-04 | Image byte/dimension/count limits, unsupported capture formats, text-only reports, missing GPS/EXIF, stable S3 reference representation | S1 requires JPEG/PNG, upload limits, optional EXIF, private objects and expiring access URLs, but supplies no numeric limits or full permission-denial policy. | Team + client |
| D-05 | GIS inventory/provenance/CRS/license, pillar/property schemas, protected layers, trail tolerance, history/safety content, elevation/temperature sources | S6 labels Historical elements “Cultural,” while S1/S2 define four pillars without Cultural; settle the mapping. S2 leaves datasets/study integration open. S3 needs history/safety data and offline trail assessment. J6-24 explicitly requires a buffer against GPS jitter, but supplies no numeric tolerance in its title. | Client/data providers + team |
| D-06 | Offline region/zoom/layer coverage, download UX, refresh/versioning, storage budget, device cache library | S2 says coverage has not been measured. S3 commits to cached base map/trails and queued reports; S1 fixes local caching. Field measurements should size the design, not silently cancel the planned offline flow. | Field research + mobile |
| D-07 | Queue implementation, deduplication schema, retry policy, upload failure recovery, durable notification delivery | S3 requires no lost/duplicate reports, but S1 lacks submission keys/delivery state. Define behavior after partial S3/database failure and a lost API response. | Mobile + backend |
| D-08 | Reconcile older UI prose with existing Figma; define remaining accessibility/tap/proximity thresholds and unrepresented screens | S6 is the UI reference and has been inspected: it uses route-first reporting, a dedicated Choose GIS Layers screen, and proximity/emergency confirmation states. S3 says camera-first and three taps; J6-19 says drawer. Follow the linked Figma screens and record reconciliation rather than inventing replacements. Dedicated staff/3D/temperature screens were not identified. | UX + client |
| D-09 | Report/media/location retention and deletion, local queue protection/sign-out policy, log redaction, abuse limits | S1 establishes privacy principles without durations, device-storage policy, or operational limits. | Client + team |
| D-10 | Hosting/deployment ownership, exact versions, supported devices, build distribution, backup/recovery and performance budgets | S1 selects technologies; S3 requires reproducible setup, checks, and an iOS build, but does not specify the operating environment or numeric budgets. | Team + client |
| D-11 | Final safety scope and approved emergency content | S2 says emergency vision is unclear. S3 plans offline references and explicit sharing; S4's live authority reporting is stretch. Do not assume an emergency-dispatch service. | Client + UX |
| D-12 (resolved November 1, 2026) | Generic `gis_layer` / `gis_feature` tables | [J6-12](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-12) calls for `trails`, `trail_boundaries`, `preserve_boundary`, and `landmarks` tables with `surface_type` and GiST indexes; S1 uses `gis_layer`/`gis_feature`. Project owner chose the generic model to prioritize flexibility. Trails, boundaries and landmarks are logical feature types; no separate physical tables or views are required. J6-12’s original wording remains historical scope and is reconciled by this decision. | Backend + team |

## Resolved direction and documentation cautions

- **November 12, 2026 — D-08 grouped elevation sources:** The owner requested
  the source-similarity explanation inside the dropdown and suggested grouping
  both datasets under one toggle. The chooser now has one Elevation switch and
  a source dropdown; only the selected source renders. USGS is the default,
  falling back to supplied DTM if unavailable. Switching off remembers the
  source, and Done/Back/retry keep the established draft/session behavior.
  The dropdown contains the short similarity and source-limit notes, a specific
  owner-requested exception to the general consolidated-disclaimer policy.
  Existing detailed source caveats remain in Disclaimers; no new note is added there.

- **November 12, 2026 — D-05 approximate two-source terrain:** The project
  owner authorized publishing the supplied DTM with its missing horizontal
  datum explicitly disclosed, and requested a separate national public elevation
  option with source/limitations clear for each. PR 4 implements separately
  attributed supplied-DTM and USGS 3DEP layers, each combining 20 ftUS bands and
  regenerated 2D relief. Source attribution appears in chooser/details and
  standing caveats remain in Disclaimers. The supplied GRS80 projection uses a
  ballpark/no-datum-shift assumption; this does not confirm a horizontal datum,
  survey accuracy, acquisition date, measured trail ascent or safety approval.
  National data is a preserved, resampled service subset; source intersections
  do not establish per-pixel acquisition/resolution. See
  [terrain evidence and contracts](../data/cascade-springs-gis/TERRAIN.md).

- **November 5, 2026 — D-08 J6-19 implementation reconciliation:** The layer
  chooser follows the dedicated screen already documented from Figma, with Map
  back, individual switches and Done, rather than the ticket's older drawer
  wording. Draft edits apply with Done and cancel on other return actions;
  applied visibility is session-only. This records implementation behavior for
  review, not a new client approval or resolution of all D-08 items. Direct Figma
  visual matching remains unverified. D-05 pillar/category mapping stays open;
  show only supported pillar metadata, without inventing a Cultural assignment.
  See [UI progress](design/ui-spec.md#layer-selection-progress--november-5-2026)
  and [evidence](development/layer-selection.md).

- **November 4, 2026 — J6-14 GPS scope:** The project owner instructed us to
  focus on map/GPS and assume the current GIS data is correct for this work.
  Implement foreground permission, position display, recentering and location
  fallbacks against the existing data/API. This does not resolve production
  provenance/pillar mapping, offline coverage, or the off-trail tolerance in D-05.
  See the [map GPS implementation and acceptance checks](../mobile/README.md#foreground-map-gps-j6-14).

- **November 1, 2026 — D-10 local iOS workflow:** The project owner selected EAS cloud builds with a local iOS Simulator and local Metro, retaining Expo SDK 57 and the existing macOS installation. Reuse the team-owned project and `development` simulator profile. Native dependency/configuration changes require a new cloud build; JavaScript edits use local Fast Refresh. Reconsider host upgrades if native-build turnaround becomes disruptive. See the [mobile setup guide](../mobile/README.md) for commands and verification. Physical-device signing, store distribution, and the supported-device matrix remain open.
- **November 1, 2026 — D-12 generic GIS schema:** Project owner confirmed
  “lets do generic, we want to prioritize flexibility.” Use `gis_layer` and
  `gis_feature`, with text stable identifiers, SRID 4326 geometry, a layer FK,
  GiST geometry index and flexible JSON object properties. The implemented
  schema extends S1 with descriptions and provenance/demo metadata; pillar is
  nullable pending D-05. Separate tables in J6-12 are superseded by this decision;
  the ticket is not marked complete. See [data model](data-model.md) and
  [mobile handoff](../backend/GIS-HANDOFF.md). Synthetic development fixtures
  are authorized by this task; approved production datasets and pillar mappings
  remain open under D-05.

- **November 1, 2026 — D-10 local backend tooling:** Project-owner instruction
  authorizes the local Workers server, Docker PostgreSQL/PostGIS, and Drizzle
  foundation. Use nvm with the repository's existing Node pin and pnpm root
  lockfile. See the [backend setup guide](../backend/README.md) for implemented
  commands. This resolves the local development workflow only. Production
  Workers/Hyperdrive hosting remains proposed; database provider, staging,
  remote credentials, backups, budget, and deployment ownership remain open.
  This foundation did not resolve domain schemas; D-12 is resolved separately above.


- **October 11, 2026 — D-10 tooling only:** During the authorized development-environment setup, the project owner installed Node 24 through nvm. The repository pins the verified Node 24.21.0 and existing pnpm 10.26.2; see the [Expo setup guide](old-plans/expo-setup.md#3-establish-reproducible-tools). Expo SDK compatibility will be checked during scaffolding. Hosting, native device tooling, distribution, and deployment ownership remain open.
- **October 11, 2026 — D-10 EAS ownership and application identifiers:** To avoid the single-person-account trap flagged in [Expo setup section 10](old-plans/expo-setup.md#10-configure-native-builds-and-team-delivery-with-eas), the mobile project is owned by the shared Expo organization `cx3803jidcc6342tsa` rather than an individual student account. `eas init` created the team-owned project `@cx3803jidcc6342tsa/cascade-springs` (projectId `bca3cac0-3a82-45b8-9df3-3ad9186796ef`). The application identifier `com.cx3803team6342.cascadesprings` is set as both the iOS `bundleIdentifier` and Android `package` in `mobile/app.json`; these are baked into builds/signing and should be treated as stable. `mobile/eas.json` defines `development` (iOS Simulator development client — the only build the setup checklist hard-requires), `preview` (internal device distribution for team review), and `production` (reserved) profiles. **Still open under D-10:** signing ownership for physical-device/TestFlight builds (requires an Apple Developer account, ~$99/yr), supported-device matrix, EAS build budget, and whether the client expects device/store distribution. No `EXPO_TOKEN` or signing credentials are committed; CI build authentication remains a later step gated on these open items.
- **October 11, 2026 — S8:** Support guest reporting, including custom-recipient and offline submissions. No account or sign-in is required for these flows. Guest ownership/access implementation remains an engineering detail, not an open question about whether guests are allowed.
- **October 11, 2026 — S8:** Custom-recipient reports are private from park administrators. Deliver only to specified recipients and exclude the report and attachments from staff access and notifications. Neither category defaults, staff roles, nor delivery failures may override this choice. Applies to [security](security.md), [data](data-model.md), [API](api.md), [offline behavior](offline-gis.md), and [UI flows](design/user-flows.md).
- S2 proposed React Native or Flutter; S1 selects **React Native with Expo**. S3 says PostgreSQL with a possible ORM; S1 selects **PostGIS and Drizzle**. Use the detailed design's selected stack.
- S3 schedules 3D terrain and temperature history as stretch work. S1 specifies the 3D implementation if delivered; it does not establish a required release date. AR is consistently stretch.
- The sprint summary in S3 references story numbers inconsistently. Trace features using the actual story headings: reporting capture is story 6, staff routing is story 7, history is story 8, offline is story 9, and safety is story 10.
- S2's offline recommendations occasionally refer to R-03, while its requirements table identifies offline as R-07. The requirements table IDs are used throughout these specifications.
- Baseline report statuses describe staff workflow. Proposed queue and email delivery states describe transport; keep them distinct.

When resolving an item, add the chosen behavior, decision date, supporting client/team reference, and affected specification links. Update contracts and migrations together so future developers do not need to reconstruct the decision from discussion history.

Use the [existing Figma](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=0-1) for UI decisions and the [Jira backlog](https://gatech-team-f1s41wh9.atlassian.net/jira/software/projects/J6/boards/2/backlog) for implementation tracking. These documents supplement those artifacts; they do not establish a competing design or task board.

## November 4, 2026 — D-05 supplied source map

Project-owner instruction authorizes pulling the linked Google My Maps data into
the project as public GIS. The [snapshot inventory](../data/cascade-springs/README.md)
records the export, provenance, WGS84 coordinates, field mapping and limitations.
The import supplies one trail and eight landmarks; it does not resolve protective
boundaries, difficulty/surface attributes, pillar assignments, redistribution
licensing, surveyed alignment, or navigation tolerances. J6-22 and D-05 therefore
remain partially open. Source HTML is retained as inert metadata only.

## November 4, 2026 — D-05 full trail-network reference

The project owner supplied a park-sign photo as the eventual map-content target
and confirmed that its GIS will arrive later. Preserve the [reference and typed
structure](design/trail-network.md); retain generic GIS tables under D-12. The
planning inventory is not published GIS. Final field mapping, colors, source
geometry, licensing, current routing and safety alignment await provider data.

## November 4, 2026 — D-05 approximate trail-name assignments

The project owner explicitly authorized best-effort splitting of the current GIS
route and naming its sections from the physical sign, accepting incomplete coverage.
This supersedes the earlier prohibition on matching this route to sign names for
this limited task. Preserve source geometry; do not trace missing trails. Seven
identities are approximate; two connections remain unnamed. The
[section review table](../data/cascade-springs/README.md#approximate-trail-sections)
records evidence, uncertainty and reproducible vertex ranges. Full-network GIS,
official identity and navigation approval remain open. The owner confirmed
that the eight existing source points should be called landmarks in the app.

## November 11, 2026 — D-05 supplied GIS source foundation

The project owner requested integration of the supplied GIS folder and then
implementation of PR 1 from the [stack plan](tasks/gis-data-integration-plan.md).
The [source package](../data/cascade-springs-gis/README.md) retains the original
archive, loose map PDF and signal image, with hashes and reproducible inspection.
The [engineering ingestion contract](../data/cascade-springs-gis/INGESTION.md)
uses source GlobalID UUIDs for segment identity, separates raw/derived attributes,
records units and publication flags, and requires explicit ownership and atomic
replacement in later PRs. Generic tables under D-12 remain the selected schema.

This authorizes source preservation and the ingestion handoff, not a new source
license, survey certification or public safety claim. Source widths are inches;
blank difficulty and zero placeholders do not become normalized measurements.
Pillars, PDF difficulty precedence (including the Springs discrepancy and
conditional South Utoy guidance), terrain horizontal datum/alignment, hillshade
registration, signal units/registration and redistribution rights remain open.
No layer is imported or published by PR 1, and the current approximate data and
legacy commands remain unchanged until PRs 2 and 3 implement supersession.

## November 11, 2026 — D-05 supplied trail selection (PR 2)

The owner's request to implement PR 2 authorizes replacing approximate trail
sections with the supplied shapefile. Retain `cascade-map-trails`, use canonical
GlobalID feature IDs, preserve all 36 source segments and eight My Maps landmarks,
and leave the approximate boundary for PR 3. Both legacy source and new trail-only
commands select supplied trails under lock `(6342, 2)`; legacy conversion remains
archive-only. [The implementation record](../data/cascade-springs-gis/TRAILS.md)
defines field mapping, publication filtering, derivation and replacement checks.

Explicit source-name mapping groups Turkeyfoot and South Utoy for the app palette
while preserving their separate labels. Existing display colors remain, including
red West versus raw source `ORAN`. Source blank difficulty remains absent; only
Big Beech Spur supplies `easy`. Width units are inches and lengths are geodesic
segment measurements. This implements the engineering contract without treating
PDF difficulty observations as approval. Licensing, surveyed accuracy, safety
tolerances, pillars, PDF precedence and raster/signal registration remain open.

## November 12, 2026 — D-05 PDF context and difficulty policy (PR 3)

The owner requested PR 3 from the supplied GIS stack and explicitly selected
“Leave difficulty unchanged.” The supplied PDF therefore provides context and
15 landmark symbols, but no route-level difficulty fallback. Springs Easy in
the PDF conflicts with the prior Moderate sign transcription; South Utoy has
conditional uphill-to-Battle-Ridge guidance. These observations remain evidence,
not segment-level defaults. PR 2 colors/attributes remain unchanged.

[The extraction/reconciliation record](../data/cascade-springs-gis/PDF-MAP.md)
defines projected registration, per-layer ownership, shared lock (6342, 2),
legacy replacement and source IDs. The hand-drawn boundary is superseded,
Waterfall has one physical marker with both source records, and unmatched My Maps
annotations retain explicit source labels. Spring vs Frog Pond / Spring physical
identity remains unresolved. Generic `building` and polygon `road` kinds extend
the logical contract without new tables. Pillars, licensing, safety tolerances,
field accuracy and terrain/signal registration remain open.

## November 13, 2026 — D-05 approximate cell-signal recovery (PR 5)

The owner's request to implement the fifth stacked GIS slice authorizes a
reproducible approximate source-observation layer. The [signal record](../data/cascade-springs-gis/SIGNAL.md)
preserves 677 recoverable categorical samples, manual controls, fit/withheld
residuals, rejected components, exclusion masks and source pixels. It explicitly
retains the basemap boundary mismatch, extrapolation and unknown source GPS/class
accuracy. This is not approval of a unit such as dBm, an exact reading, carrier,
survey date, current connectivity, interpolation, field accuracy or safety use.
Pillar assignment, licensing and raw survey provenance remain open.

## November 13, 2026 — D-10 primary iOS simulator

The owner explicitly requested iOS 26 as the primary simulator target and asked
that development documentation reflect it. Use an iOS 26 iPhone for daily native
verification and screenshots; the existing `Cascade iOS 26` device is an iPhone 17
on iOS 26.3. Older runtime checks supplement this target and must retain their
actual runtime labels. This does not certify physical devices or replace Android
checks, JavaScript exports or native compilation evidence.

## November 13, 2026 — D-08 natural rendering order

The owner requested a stacked PR for natural GIS z ordering. The selected
[paint order](development/map-layer-order.md) puts ground and analytical overlays
below route strokes, place markers and labels above strokes, and GPS above GIS.
This refines the older J6-19 “trails always on top” title for marker legibility;
it does not change Jira ownership, palette, geometry, visibility defaults or access.
Stable empty terrain slots and explicit native placement remove mount-order
dependence. Hit priority follows landmark → trail → observation for crowded hits.

## November 13, 2026 — D-08 public visibility presets

The owner requested Visitor (basic trails), Staff (useful context) and Researcher
(more layers) as three chooser options in a PR above natural rendering order.
The [initial mapping](development/layer-presets.md) uses trail/boundary/landmark
for Visitor, adds water/roads/buildings/natural areas plus USGS elevation for
Staff, and adds signal observations for Researcher. Supplied elevation is the
fallback when USGS is absent; manual switches can select either/both. These are
engineering defaults for the current public catalog, not claims of client-approved
role permissions. Each fresh session starts in Visitor. Applied preset/overrides
survive in-session retry, choices stay editable with Done/Back, and unknown content
starts hidden. Persistence across restarts is not added. Existing access rules,
source caveats and report routing are unaffected.
