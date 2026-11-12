# User flows and acceptance

These flows follow the [existing Figma prototype](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=0-1), supplemented by S3 stories and S4 scenarios. Use the [UI specification's direct frame links](ui-spec.md#screens-and-interactions) for screen structure and the [Jira backlog](https://gatech-team-f1s41wh9.atlassian.net/jira/software/projects/J6/boards/2/backlog) for implementation tracking. They describe expected behavior, not completed functionality.

S8 confirms that all capture/submission flows below support guests without account creation or sign-in. Custom-recipient reports are private from park administrators, including their photos, metadata, and recipient lists.

| Flow | Steps and observable outcome | Exceptions / decisions |
| --- | --- | --- |
| Navigate a trail | Open app → shared map with trails/boundaries → permit location → see moving blue dot → pan/zoom/recenter. Trail boundaries remain clear with other layers enabled; off-trail indication follows the agreed tolerance. | Denied permission preserves map browsing. Missing GPS and missing network have distinct feedback. Tolerance remains open. S3 stories 1, 3. |
| Explore sustainability | Open Choose GIS Layers → read descriptions/badges → independently toggle rows → Done → return to map → select a feature. Trails stay above other layers. | Use Figma scenario 2 layout; reconcile Jira's drawer wording and the Cultural badge in D-08/D-05. Full catalog/performance threshold remain open. J6-19–J6-21. |
| Submit a field report | Map → Report an Issue → choose issue/destination → Add Details with photos, optional commentary, and consented GPS/time → Submit Report → Sending → Sent or Failed. | Follow Figma scenario 3's route-first order; D-08 records S3's camera-first discrepancy. Preserve details for retry. Server acceptance does not mean an email was delivered. |
| Report offline | Capture report → submit while offline → see pending state → close/reopen app → report and photos remain → reconnect → automatic upload → see accepted state. | Interrupted/replayed uploads produce one observation and preserve delivery mode/recipients. Guest sync requires no sign-in. A local draft is never labeled sent. S3 story 9; S8. |
| Route to self/team | Custom Destination → Geotagged Report Details → Recipient Emails → Review & Send → Sent or Recipient/Send Failure. Allow one or more removable addresses and show who will receive the report. | Guests supported. Send only to listed addresses; park administrators cannot view the report. Failure retains the private draft for correction, never park fallback. D-03 covers schema/delivery mechanics. |
| Review personal reports | Open own-report list → select a report → see saved status and any supported follow-ups. | Require proof of ownership for account/guest report access; guest recovery and follow-up storage remain open. A null user ID or report ID does not authorize access. Do not promise a messaging thread absent a design. |
| Learn site history | Enable history layer → select landmark → read text/images → return to map. Proximity may offer a small prompt without preventing manual selection. | Location and content must match. Proximity behavior is open; AR is stretch and is not required for normal historical content. S3 story 8; S4 scenario 4. |
| Manage a report | Authorized staff opens park-routed report table/map → filters by pillar/category/status/date → inspects report → updates permitted status/routing or exports selected records. | Custom-recipient reports are excluded from all staff views, direct access, media, exports, and mutations, even for administrators. Remaining Worker permissions, status transitions, and export format require decisions. S3 story 7; S8. |
| Access safety information | Emergency Hub → Exact Location or Confirm Location Share → review location/recipients → Confirm & share → shared/failure state. Calling follows Confirm 911 Call → Phone Handoff. | Follow Figma scenario 7. Calling, sharing, and reports are separate; no data is sent before confirmation. Reference content works offline; show location-unavailable fallback. The live emergency-report frame remains stretch. |

For release verification, exercise the normal and exception paths on iOS, then the supported Android targets. Cover permissions, poor/no connectivity, app restart with queued photos, duplicate retries, restricted records/media, and overlapping map layers. Use approved client GIS/content fixtures and simulated GPS positions; validate geographic alignment during field testing. The exact device matrix and numeric tolerances are D-05/D-10 decisions.

### Public feature detail acceptance (J6-20)

1. With public GIS loaded and location off or denied, tap a landmark, trail and
   boundary. Confirm details match the selected snapshot record; no new location
   prompt or network request should occur. Overlaps prefer points, then lines,
   then polygons. Tapping basemap content or the device position alone does not
   open a public feature record.
2. Check source descriptions containing HTML/images: show readable inert text,
   without fetching images, executing markup or activating URLs. Missing names
   and descriptions have fallbacks; unavailable domain attributes are omitted.
3. Close with Done, iOS dismissal, accessibility escape or the Android system
   back action as applicable. Confirm browsing and an enabled GPS session remain
   available without selecting a new camera target.
4. Open another feature; confirm content is replaced. Leave Map or replace/fail
   the GIS snapshot; confirm obsolete details disappear and do not reopen on
   return. Repeat with large text and assistive technology on supported devices.

Implementation evidence and explicit device/design limits are recorded in
[feature details](../development/feature-details.md). Historical/proximity content
remains separate from public feature details.

### Public layer selection acceptance (J6-19)

1. Open Choose GIS Layers from Map with location off or denied. Show current
   public catalog names, type descriptions, independent native switches and
   supported pillar badges only when metadata supplies them. Do not infer pillar
   assignments or fetch features again just to open the screen.
2. Toggle one or several rows. Done applies the draft and returns to the mounted
   map; Map back, system back or swipe back cancels it. Reopen to see the applied
   choices. Pan/zoom must survive applying choices without an automatic refit.
3. Hidden features disappear from rendering, hit-testing, counts and the trail
   key. Re-enable repeatedly without duplicate geometry or legend entries.
   With everything off, show the all-hidden explanation and retain basemap,
   zoom, return-to-preserve and independent location controls.
4. Keep trails above other GIS overlays. The device position is unaffected by
   public layer switches. The existing location lifecycle still pauses GPS while
   Map is blurred and resumes an enabled session without an automatic prompt.
5. Without a catalog, keep Map return available and Done disabled; distinguish
   loading, unconfigured and failed reads, with Retry for a failed read. Discard
   draft edits if the catalog is replaced. Preserve applied choices across an
   in-session retry, ignoring unknown IDs and enabling new catalog IDs by default.
   Choices reset on a full application restart; durable offline GIS is separate.

See [layer selection evidence](../development/layer-selection.md) for automated
checks, iOS smoke results and remaining design/device verification.

The current map GPS slice starts from **Use my location** and native foreground
permission. Recenter uses the latest fix; subsequent fixes move the dot while
preserving manual browsing. Denial does not block the map. On blur/background or
explicit disable, subscriptions and the displayed fix are cleared. On return,
permission is checked again without a new automatic prompt. A 30-second display
freshness default removes expired dots/recentering until GPS recovers. See the
[mobile GPS acceptance checklist](../../mobile/README.md#acceptance-checks) for
permission, Settings recovery, simulated movement, lifecycle and network cases.

The following approximate-name/color checks are historical. For the current
supplied-trail slice, import the selected sources and verify 36 segments and eight
landmarks, plus the separate approximate boundary when imported. Check the nine
named route families and one unnamed legend entry; source names remain distinct
even where Turkeyfoot and South Utoy share a family. With location off/denied,
open details and verify width in inches, roughness, source segment and supplied
notes without inventing missing difficulty. Hide/show trails and confirm counts,
legend, hit testing and camera remain consistent. See
[verification and screenshots](../../data/cascade-springs-gis/TRAILS.md#verification-and-limits).

For the historical approximate-name slice, opening the map after re-import showed named
sections on the existing partial route and an approximate-name notice. Pan/zoom
reveals labels as room permits; ambiguous connections remain drawn without name
labels. Permission denial preserves both browsing and the notice. Full-network
coverage and field identity checks remain pending; see the
[section mapping](../../data/cascade-springs/README.md#approximate-trail-sections).

For the trail-color slice, verify all seven loaded identities use the
[display palette](trail-network.md#approximate-trail-display-palette), both Gateway
sections stay visible with dark casing, and the two unnamed connections are
dashed gray. Pan/zoom across junctions and light/dark basemap content; labels,
landmarks and the approximation notice must remain readable. The scrollable
legend must match the strokes, deduplicate Gateway and omit Bigleaf Magnolia and
Spur Trails while their geometry is missing. Unknown or malformed trail IDs must
render safely as solid gray. Check legend scrolling, text scaling and browsing
with location denied on iOS and supported Android targets. Retry after a failed
GIS read must repopulate the legend from the recovered data; this change adds no
durable offline restart/retry behavior.

For PR 3, import the selected source collection and verify seven layers/69
features. With location off/denied, browse context and open details. Confirm
blue water/green natural areas/gray roads/brown buildings and a single purple
boundary; trails remain legible. At detail zoom, named POIs and source annotations
are readable. Waterfall must have one marker retaining its My Maps note; Spring
remains explicitly unmatched. Hide/show each context layer with Done: its features,
hits and key entries change without refitting the map or adding trail-key entries.
Difficulty stays unchanged. See [PR 3 evidence](../../data/cascade-springs-gis/PDF-MAP.md#verification-and-limits).
