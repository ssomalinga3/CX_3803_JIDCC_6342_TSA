# Project specifications

Cascade Springs Nature Conservancy Smart GIS: Mapping Atlanta's Ecological Core. Team DCC-6342-TSA; client David Lloyd Davis. Consolidated on October 11, 2026.

## Reading guide

| Document | Implementation questions answered |
| --- | --- |
| [Architecture](architecture.md) | Components, selected technologies, responsibilities, and dependencies |
| [Data model](data-model.md) | Nine source entities, fields, relationships, and spatial constraints |
| [API and interfaces](api.md) | Data exchange, report processing, and proposed HTTP contracts |
| [Security and privacy](security.md) | Access boundaries, location consent, private media, and secrets |
| [GIS and offline operation](offline-gis.md) | Dataset preparation, caching, report queues, and reconnect behavior |
| [UI specification](design/ui-spec.md) | Screens, map interactions, reporting, and prototype references |
| [Trail network reference](design/trail-network.md) | Supplied park sign, future layer inventory and GIS attribute structure |
| [User flows](design/user-flows.md) | Main tasks, failure states, and observable acceptance conditions |
| [Open decisions](decisions.md) | Unresolved product and engineering choices that must not be silently assumed |
| [Architecture diagram source](diagrams/architecture.puml) | Editable PlantUML supplied with the assignment request |
| [Backend package](../backend/README.md) | How to run, build, test, and verify the Node/TypeScript server |
| [Local startup commands](development/local-startup.md) | Complete PostGIS, Worker API, Metro, and iOS Simulator startup and verification |
| [Layer selection verification](development/layer-selection.md) | J6-19 behavior, iOS smoke evidence, screenshots and remaining acceptance checks |
| [Windows/Android startup](development/windows-android.md) | PowerShell prerequisites, EAS cloud build, Android Emulator, Metro, Worker and PostGIS |
| [First task + agent plan](tasks/first-task-gis-layers.md) | First implementation task (scope/acceptance) and the [proposed plan](tasks/first-task-implementation-plan.md) |
| [Supplied GIS integration plan](tasks/gis-data-integration-plan.md) | Source inventory, five stacked PRs, implementation pointers, acceptance checks, and fresh-agent handoffs |
| [Supplied GIS source package](../data/cascade-springs-gis/README.md) | Preserved originals, hash manifest, pinned inspection environment, and incoming property/replacement contract |
| [Supplied PDF map integration](../data/cascade-springs-gis/PDF-MAP.md) | PR 3 extraction, registration evidence, landmark reconciliation and selected import policy |
| [Two-source terrain integration](../data/cascade-springs-gis/TERRAIN.md) | PR 4 supplied/USGS elevation options, registration, bounded assets, import/version contract and limitations |
| [Supplied trail integration](../data/cascade-springs-gis/TRAILS.md) | PR 2 conversion/import commands, exact source/route mapping, supersession, verification and screenshots |

## How to interpret these specifications

**Baseline** means a requirement or technical decision stated in the sources below; it does not claim that the feature is implemented. **Proposed** marks implementation detail added to make the design concrete but not established by those sources. **Open** means a decision still needs to be recorded. Resolve the applicable open items before implementing affected behavior; do not treat proposed API paths or schema additions as previous client approvals.

The detailed design supplies the selected technical architecture. The research supplies client requirements and their uncertainty. The iteration plan adds intended behavior and acceptance criteria. **The existing Figma prototype is the UI reference; Jira is the live implementation tracker.** Use Figma's linked screens instead of redesigning them from prose, and consult Jira for current tasks, ownership, and sprint status. Differences between sources are recorded in [open decisions](decisions.md), rather than silently resolved. Review and update these documents as sprint decisions are made.

## Sources

| ID | Source and review basis |
| --- | --- |
| S1 | **Detailed Design Document V1.pdf**, supplied local PDF; all 12 pages read, including the component diagram on p. 8 and ER diagram on p. 10. [Team Word source](https://gtvault.sharepoint.com/:w:/r/sites/DCC-6342-TSAA/_layouts/15/Doc.aspx?sourcedoc=%7B55f8c4c8-c70d-4f65-8d58-678044ad485f%7D&action=edit). The PDF, rather than later edits to the Word file, is the technical baseline used here. |
| S2 | [User Research Assignment DCC-6342](https://gtvault.sharepoint.com/sites/DCC-6342-TSAA/Shared%20Documents/General/Project/User_Research_Assignment_DCC-6342.docx?web=1), read in SharePoint's accessible viewing mode. Sections 1–5 provide scope, findings, R-01–R-09, and unresolved client questions. |
| S3 | [Iteration Plan](https://gtvault.sharepoint.com/:w:/s/DCC-6342-TSAA/IQAlxKBPmOQRQbasTB9ULcm5Af8W-_V15zh7ZnclfphklS4?e=ZH0faz), identified in SharePoint and reviewed using the local 21-page export `Iteration_Plan_Template_Final_TOC - Copy.pdf`. Citations below use story numbers and PDF pages; the live file may change. |
| S4 | `Task_Scenarios_DCC_6342.pdf`, local three-page project assignment, scenarios 1–7. [Team Word source](https://gtvault.sharepoint.com/:w:/r/sites/DCC-6342-TSAA/_layouts/15/Doc.aspx?action=editNew&sourcedoc=%7B6d5c4965-01d1-4f2b-ae8d-5dfc5f96af5f%7D&web=1). Used to identify report history, recipient override, and history proximity flows. |
| S5 | Component PlantUML supplied directly with this request, preserved in [architecture.puml](diagrams/architecture.puml). |
| S6 | [Existing mid-fidelity Figma prototype](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=0-1&p=f&t=6Aj9ZpRWAzGsIdCs-0). Page/frame metadata and representative renders for layer selection, report routing/details, queued reports, custom recipients, and location-share confirmation reviewed October 11, 2026. Direct screen links are in [UI specification](design/ui-spec.md). |
| S7 | [JIDCC-6342 Jira backlog, project J6 / board 2](https://gatech-team-f1s41wh9.atlassian.net/jira/software/projects/J6/boards/2/backlog?cloudId=f152a524-e8ec-400e-ae70-74c3fce2b4a7&visitedUserSeg=true), read October 11, 2026. The supplied duplicate URL refers to this same board. Source for engineering work items and live delivery tracking; ticket presence is not proof of implementation. |
| S8 | Project-owner clarification in this repository task, October 11, 2026: guest reporting must be supported; reports with custom recipients must not be visible to park administrators. This resolves those previously open product questions and takes precedence over earlier unspecified access rules. |

SharePoint references require team access. These Markdown files summarize the implementation-relevant information so a developer can read the specifications without opening the original assignments. The local blank research template was not used as project evidence.

## Jira implementation references

Use the live board for status and assignees rather than maintaining a second backlog here. The reviewed board displayed J6-1 and J6-12–J6-26 in Sprint 1; later sprint containers and the unscheduled backlog were empty. This is a dated observation, not a change to the feature scope in the iteration plan.

| Work area | Existing Jira items | Specification |
| --- | --- | --- |
| GIS persistence | [J6-12 spatial tables/indexes](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-12), [J6-17 layer schema](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-17), [J6-22 trail geometry](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-22) | [Data model](data-model.md); reconcile table structure in D-12 |
| GIS interfaces | [J6-13 GeoJSON endpoints](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-13), [J6-18 cached read-only layers](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-18) | [API](api.md) |
| Map and layers | [J6-14 map/GPS](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-14), [J6-19 toggles](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-19), [J6-20 feature details](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-20) | [UI](design/ui-spec.md) |
| Permissions and privacy | [J6-15 location handling](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-15) | [Security](security.md) |
| Trail safety | [J6-23 trail styling](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-23), [J6-24 GPS-jitter buffer](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-24), [J6-25 off-trail indicator](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-25) | [GIS behavior](offline-gis.md) |
| Verification | [J6-16 GPS/performance/API tests](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-16), [J6-21 layer tests](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-21), [J6-26 geometry/simulated walk](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-26) | [User flows](design/user-flows.md) |

## Scope and traceability

The primary users are visitors/community members, restoration workers/volunteers, and researchers/Conservancy administrators. These user groups are not automatically equivalent to authorization roles.

Reporting is available without an account. Custom-recipient reports support personal/organization recordkeeping and are excluded from park-administrator access, including staff lists, details, photos, exports, and notifications. Send only to the reporter's specified recipients; delivery failures must not fall back to park routing (S8).

| Research ID | Required behavior | Source priority / qualification | Specification |
| --- | --- | --- | --- |
| R-01 | Shared interactive trail map with real-time GPS position | Must; confirmed | [UI](design/ui-spec.md), S3 story 1 |
| R-02 | Trail routes and protective boundaries; off-trail indication in the iteration plan | Must; tolerance unspecified | [GIS](offline-gis.md), S3 story 3 |
| R-03 | Photo report with automatic coordinates/time, category, optional note | Must; confirmed | [Interfaces](api.md), S3 story 6 |
| R-04 | Categories aligned to Human, Social, Environmental, Economic | Must; category/sublayer mapping open | [Data](data-model.md), S3 stories 2 and 6 |
| R-05 | Route reports to appropriate recipients, including the submitter | Must; default recipients open | [Interfaces](api.md), S3 story 7 |
| R-06 | Independently toggle GIS sublayers on one map | Must; full layer catalog open | [UI](design/ui-spec.md), S3 story 2 |
| R-07 | Cached base map/trails and queued offline reports | High; strictness pending coverage measurements | [Offline](offline-gis.md), S3 story 9 |
| R-08 | Location-based historical text and imagery | Low in research; planned in iteration plan | [Flows](design/user-flows.md), S3 story 8 |
| R-09 | Emergency information and explicit location sharing | Medium; client vision still open | [Flows](design/user-flows.md), S3 story 10 |

The priority labels above come from S2; they do not remove features scheduled in S3. iOS is the primary platform and Android is secondary (S1 p. 7). 3D terrain and historical temperature visualization are stretch work in S3 stories 4–5; S1 fixes the renderer choice if 3D terrain is built. AR remains a stretch goal. Live sensor integration, an Atlanta-wide parks platform, and automated report cleaning/moderation are out of scope (S2 §1); server input validation remains required.
