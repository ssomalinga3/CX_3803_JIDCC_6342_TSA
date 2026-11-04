# UI specification

UI baseline: the existing Figma prototype (S6), supported by S1–S4 and the Jira implementation backlog (S7). See the [source index](../README.md#sources).

## Design direction and references

Prioritize a smooth iOS experience using React Native/Expo and familiar native components; Android is secondary. The shared interactive map is the main screen. Keep visitor reporting brief and automatic metadata capture in the background after permission is granted.

S8 confirms guest reporting: capture, submission, and offline sync must work without registration or sign-in, including self/organization recording. In custom-recipient review, clearly state that the report goes only to the listed recipients and is not visible to park administrators. Keep this mode private if delivery fails; offer correction/retry without switching to park routing. The My Reports ownership/recovery mechanism for guests remains an implementation detail, not a reason to require an account for reporting.

Use the team's existing [mid-fidelity Figma prototype](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=0-1&p=f&t=6Aj9ZpRWAzGsIdCs-0) as the source for screen structure, controls, visual hierarchy, and interaction states. Implement the linked frames below rather than designing replacement screens from this prose. Page/frame metadata and six representative screen renders were reviewed on October 11, 2026; every prototype connection has not been interaction-tested.

The reviewed screens use 390 × 844 iPhone frames, iOS-style back navigation and toggles, light gray backgrounds, white rounded cards, blue primary actions, and orange pending/warning messages. Preserve this direction and use the live Figma components for measurements and styling; the reference size is not a fixed device constraint. Example photos, addresses, coordinates, timestamps, and destination names are prototype content, not production records. Controls labeled “Preview Failure State,” “Test invalid email,” or similar demonstrate states and are not production actions.

Use the [J6 Jira backlog](https://gatech-team-f1s41wh9.atlassian.net/jira/software/projects/J6/boards/2/backlog) for implementation tasks, ownership, sprint placement, and current status. Map UI work is tracked in [J6-14](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-14), layers in [J6-19](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-19), feature details in [J6-20](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-20), and trail styling/indication in [J6-23](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-23) and [J6-25](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-25).

S2 examined Trailforks, ArcGIS Field Maps/Survey123, Avenza Maps, and SeeClickFix. Their status colors, automatic metadata, offline downloads, and short reporting flows are inspiration, not independently approved product requirements.

## Screens and interactions

| Surface / Figma frame | Implementation behavior |
| --- | --- |
| [Location permission](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=17-4), [active navigation](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=17-26), [trail safety](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=17-61) | Native permission request; map/trails, position, pan/zoom/recenter, and trail-boundary warning. Denial preserves map browsing. |
| [Choose GIS Layers](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=32-40), [layers applied](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=32-116) | Dedicated selection screen with Map back action, descriptive rows, pillar badges, individual toggles, and Done. Follow Figma's screen layout; Jira's “drawer” terminology needs reconciliation in D-08. J6-19 requires trails above other layers. |
| [Route the Report](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=51-91), [Add Details](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=51-93) | Choose issue/destination first, then photos, commentary, automatic GPS/time, and Submit Report. Show the destination. Preserve [sending](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=51-95), [sent](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=51-97), and [failed](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=51-99) states. |
| [My Reports](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=51-101) | Use the existing personal-report surface; ownership access and follow-up storage remain backend decisions. |
| [Recipient Emails](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-260), [Review & Send](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-262) | Custom flow allows one or more removable email recipients and review before sending, only to listed addresses. [Recipient/send failure](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-266) retains the draft. D-03 covers backend enforcement and schema. |
| [Nearby History Prompt](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=52-186), [History Detail](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=52-188) | Preserve prompt and manual marker/detail entry. [AR Reconstruction](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=52-190) remains stretch. |
| [Offline GIS Availability](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-245), [Report Queued](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-249), [Connection Restored](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-251) | Show offline availability, locally retained photos/location/text, waiting-to-send status, automatic sending, Check connection, and Edit draft. Pending is distinct from sent. |
| [Emergency Hub](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-271), [Confirm Location Share](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-277) | Keep emergency entry reachable; show location/recipient preview and confirm before sharing. Include [location unavailable](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-281), [call confirmation](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-275), and [phone handoff](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-285). Calling, sharing, and reporting are separate actions. |

Staff administration, 3D terrain, and a temperature timeline still have requirements in S1/S3, but no dedicated screen for them was identified in the reviewed page inventory. Do not invent a completed design or remove the feature on that basis.

S3 specifies camera-first reporting and a three-tap target; Figma explicitly shows route-first reporting followed by details. This specification follows the existing Figma screens for UI implementation and records the discrepancy in D-08. Do not claim the multi-screen prototype meets the tap target without measuring the agreed path.

The layer screen labels Historical elements as “Cultural,” while S1/S2 specify Human, Social, Environmental, and Economic. Record the label-to-domain resolution in D-05 before coding the category contract; do not silently introduce a fifth persisted pillar. Prototype layer examples do not establish that each dataset is available.

## Feedback and fallback requirements

Denied location access must leave map browsing usable with a clear notice. Report submission must distinguish success, failed transmission, and offline pending state. Historical content should open from a selected marker; proximity prompts are requested in S4 but the trigger distance and repeated-prompt behavior remain open.

Proposed implementation guidance: use text/icons as well as color for states, label controls for assistive technologies, support readable native text sizes, and keep primary actions reachable without precise map gestures. Show loading/empty/unavailable states instead of a blank screen. Preserve entered report content after a recoverable failure. Specific accessibility and performance acceptance targets must be recorded with the final prototype.

## Implementation progress — November 1, 2026

The mobile Map tab now implements the native online basemap foundation of J6-14:
pan/zoom, return to the initial preserve viewport, floating header, attribution,
and loading/unavailable/retry states. It uses the existing active-navigation frame
for layout while explicitly showing location off and the limits of the preview.
GPS, approved GIS overlays, layers/report/emergency actions, and offline coverage
remain unimplemented. See [mobile map setup and dependencies](../../mobile/README.md#native-map-preview-j6-14-first-slice).
OpenFreeMap Liberty is used for development only; D-05/D-06 remain open for
production data/provider approval and offline policy.

## API integration progress — November 1, 2026

The combined integration branch connects the existing map layout to the public
GIS catalog and GeoJSON collections. It renders polygon fill/outline, trails
above polygons, and landmark points, fitting the returned extent. The information
panel distinguishes unconfigured/loading/empty/unavailable states and includes
Retry layers plus explicit synthetic-data labeling. The source layer-selection,
GPS, report, safety, and offline flows remain future work. The
[integration guide](../development/integration-branch.md) records setup,
verification and limitations; this is an online development slice using synthetic
fixtures, not approved navigation or a completed J6-14/J6-19 flow.
