# Public map visibility presets

Branch `gis/07-layer-presets` is stacked on
[natural ordering PR #39](https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA/pull/39).
The owner requested three starting sets in Choose GIS Layers: Visitor, Staff and
Researcher. All existing individual switches remain available.

## Defaults for the current public catalog

| Layer                        | Visitor    | Staff       | Researcher  |
| ---------------------------- | ---------- | ----------- | ----------- |
| Supplied trails              | On         | On          | On          |
| Preserve boundary            | On         | On          | On          |
| Landmarks/source annotations | On         | On          | On          |
| Water                        | Off        | On          | On          |
| Roads                        | Off        | On          | On          |
| Buildings                    | Off        | On          | On          |
| Natural areas                | Off        | On          | On          |
| USGS elevation               | Off        | On          | On          |
| Supplied elevation           | Off        | Off         | Off         |
| Cell-signal observations     | Off        | Off         | On          |
| **Visible layers/features**  | **3 / 59** | **8 / 102** | **9 / 779** |

Staff and Researcher use USGS elevation when available, falling back to supplied
elevation if USGS is absent. Presets do not superimpose both alternatives by
default; the Elevation switch and source dropdown select one alternative at a time. These defaults are
an engineering mapping of the requested audiences to the available public
catalog. They do not infer new source attributes or restricted staff/researcher
data. Unknown layer types remain listed but default hidden until manually enabled.

## Interaction and lifecycle

Each fresh app/provider session starts in Visitor. Selecting a radio option
immediately replaces visibility with that preset's defaults for the current catalog.
Individual switches also update the map immediately. Done only closes the chooser;
there is no separate Back button. System/swipe back retains changes. Done remains
available when the catalog is loading or unavailable. Individual switches can
customize any preset, including selecting either elevation source or hiding everything.
The chooser labels manual differences “Customized from Visitor/Staff/Researcher”
and clears the radio selection until a preset is selected again. There are still
exactly three preset options. Re-selecting one resets manual differences.

Applied state contains the selected preset plus explicit per-layer visibility
overrides. Overrides survive route changes and in-session API retry. Newly
available layers follow that preset's recognized type/source rules; existing
overrides keep their layer identity. Catalog failure offers no editable layer
choices; replacement/retry reconciles the already applied choices. Only current public catalog IDs
can become overrides. A new app/provider session resets to Visitor; no disk
preference, authentication role, report state or durable offline cache is added.

The public loader still validates/loads one complete snapshot. Presets only
filter display, hits, counts, images and legends; selecting one does not fetch
again, request location, move the camera or change z order. The full catalog
remains in the chooser. These public viewing presets grant no server access;
private layers and custom-recipient reports keep their existing restrictions.

`mobile/src/data/layer-presets.ts` owns defaults and override reconciliation.
`MapGisProvider` owns applied session state; the chooser edits it directly.
No backend schema, API, source bytes or native dependency changes are required.

The chooser uses Expo Router's native stack: `gestureEnabled: true` explicitly
keeps iOS edge-swipe back available, and Android retains normal system back.
There is no custom gesture or back handler. Done provides a visible exit and
falls back to Map for a direct link without stack history. See the
[native stack gesture contract](https://reactnavigation.org/docs/native-stack-navigator/#gestureenabled).

## Acceptance and verification

On iOS 26, launch a fresh session and confirm Visitor (3 layers / 59 features).
Open the chooser and select Researcher, then leave without Done: reopen and confirm
Researcher is retained. Switch to
Staff and confirm USGS relief plus context (8 / 102), then apply Researcher and
confirm the signal samples/key appear (9 / 779). Return to Visitor: both terrain
and the signal key disappear. Keep a zoomed camera through all changes.

Manually enable a nondefault layer, verify the Customized label, apply and reopen.
Hide all layers, confirm basemap/location controls remain usable, then reset a
preset. Retry GIS after an API failure, replace the catalog while the chooser is open,
and restart the provider to verify the lifecycle above. Preset names must never
alter authentication, data access or recipients.

Regression tests use the committed ten-layer dataset for counts/membership and
cover immediate preset/reset/custom/all-hidden changes, Done/route exits, no
GPS/refetch/refit, single-source terrain/fallback, unknown/new layers, failure/
retry, catalog replacement and session
restart. Run `pnpm verify`; native execution and JavaScript exports remain separate
evidence. The November 14 restack incorporates the parent's grouped elevation chooser;
source selection also applies immediately and survives leaving the screen.

### Initial checks — November 13, 2026

This initial evidence predates the immediate-change clarification; its Back
cancellation behavior is superseded by the follow-up below. The chooser
screenshot now shows the current immediate-change interface.

- `pnpm verify` passed: formatting, lint, type checks, 122 backend unit tests
  (26 database tests skipped locally), 131 mobile tests, and separate iOS/Android
  JavaScript exports.
- Primary native smoke: iPhone 17, iOS 26.3, existing development build. Fresh
  Visitor rendered 3 layers / 59 features; Back canceled a Researcher draft.
  Applying Staff rendered 8 / 102 with USGS relief and no signal legend;
  Researcher rendered 9 / 779 with signal samples and legend. Manual signal
  selection showed “Customized from Staff” and cleared its radio selection;
  choosing Researcher reset the customization. The zoomed camera stayed fixed
  and location stayed off. All three labels fit on the chooser.
- Screenshots: [Visitor](../images/ios26-preset-visitor.png),
  [chooser](../images/ios26-preset-chooser.png),
  [Staff](../images/ios26-preset-staff.png), and
  [Researcher](../images/ios26-preset-researcher.png).

Android native execution, a fresh native compilation, Dynamic Type sizes,
device offline restart/retry and permission-denial flows were not rerun in this
slice. No native dependencies changed. Automated coverage exercises preset
state through catalog failure/retry and fresh provider sessions; bundle export
does not establish native compilation or device behavior.

### Immediate-change follow-up

The owner requested immediate updates, removal of the separate Back button,
and standard native back alongside Done. Regression tests now assert immediate
map/legend/count/hit updates, preservation through route removal/reopen and
catalog replacement, all-hidden/reset behavior, and an enabled Done exit during
catalog failure. All 131 mobile tests pass; `pnpm verify` passes formatting,
lint, types, 122 backend tests (26 database cases skipped locally), and both
platform JavaScript exports. The explicit stack gesture option also passes
mobile type checking.

On the existing iPhone 17 / iOS 26.3 client, Researcher selection immediately
updated the chooser to 9/10, Done returned to 9 layers / 779 features, and
reopening retained Researcher. Turning signal off immediately showed
“Customized from Researcher” and 8/10; Done returned to 8 layers / 102 features
with no signal key and location still off. The Back button is absent; the
[updated screenshot](../images/ios26-preset-chooser.png) records the layout.
The native edge-swipe attempt could not execute because coordinate automation
returned `noWindowsAvailable`; actual iOS swipe and Android system-back execution
remain manual acceptance checks. Route-removal tests establish retained state,
not successful physical gesture execution.
