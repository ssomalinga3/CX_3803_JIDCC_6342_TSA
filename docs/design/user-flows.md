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

J6-15 implements the permission portion of navigation: open Map without a prompt →
tap Allow location access → native foreground prompt. Denial preserves map controls
and displays a notice; blocked permission offers Settings. Returning from Settings
or reopening the app rechecks the OS state without prompting. Disabled location
services have a distinct notice. A grant is labeled as access permission, not as
an acquired GPS position. Blue-dot navigation and GPS recenter remain J6-14.

### Live map GPS acceptance (J6-14)

1. With no consent, browse and zoom without a position marker. Only Allow location
   access prompts. Denial retains browsing; Settings recovery rechecks access.
2. Grant foreground access: see acquisition feedback, then a blue dot only for a
   valid fresh device fix. Approximate permission is labeled and accepted.
3. Pan/zoom while fixes change: the dot updates and the camera stays where the
   visitor left it. Recenter moves to the fresh fix; Return to preserve uses the
   browsing center, which never becomes a visitor fix.
4. Stop fixes: show stale feedback, remove the dot and disable recenter. No initial
   fix shows GPS unavailable after the acquisition window. Retry GPS starts a new
   session; a later fresh fix can also recover the existing watch.
5. Leave Map, background, revoke permission, or unmount: stop tracking and reject
   late callbacks. Return with permission: recheck before acquiring anew. Revoked
   permission and services-off feedback remain distinct from network/API errors.
6. Verify GIS requests do not change when fixes arrive/recenter; no visitor
   coordinates enter logging, persistent storage or error messages. Online tiles
   still follow the viewed viewport. This does not establish offline navigation,
   report retry/deduplication, safe trail alignment or physical-device accuracy.

See [timing proposal](../decisions.md#j6-14-gps-ux-timings-proposed) and the
[verification record](../../mobile/README.md#live-gps-j6-14).
