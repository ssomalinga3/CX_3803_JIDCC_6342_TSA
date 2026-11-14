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
default; a visitor can still enable either or both manually. These defaults are
an engineering mapping of the requested audiences to the available public
catalog. They do not infer new source attributes or restricted staff/researcher
data. Unknown layer types remain listed but default hidden until manually enabled.

## Interaction and lifecycle

Each fresh app/provider session starts in Visitor. Selecting a radio option
replaces the chooser's draft with that preset's defaults for the current catalog.
Done applies it; Back or another exit discards it. Individual switches can then
customize any preset, including enabling every public layer or hiding everything.
The chooser labels manual differences “Customized from Visitor/Staff/Researcher”
and clears the radio selection until a preset is selected again. There are still
exactly three preset options. Re-selecting one resets manual differences.

Applied state contains the selected preset plus explicit per-layer visibility
overrides. Overrides survive route changes and in-session API retry. Newly
available layers follow that preset's recognized type/source rules; existing
overrides keep their layer identity. Catalog failure cannot apply a draft, and
catalog replacement discards obsolete drafts. Only current public catalog IDs
can become overrides. A new app/provider session resets to Visitor; no disk
preference, authentication role, report state or durable offline cache is added.

The public loader still validates/loads one complete snapshot. Presets only
filter display, hits, counts, images and legends; selecting one does not fetch
again, request location, move the camera or change z order. The full catalog
remains in the chooser. These public viewing presets grant no server access;
private layers and custom-recipient reports keep their existing restrictions.

`mobile/src/data/layer-presets.ts` owns defaults and override reconciliation.
`MapGisProvider` owns applied session state; the chooser owns its pending draft.
No backend schema, API, source bytes or native dependency changes are required.

## Acceptance and verification

On iOS 26, launch a fresh session and confirm Visitor (3 layers / 59 features).
Open the chooser and draft Researcher, then Back: the map stays Visitor. Apply
Staff and confirm USGS relief plus context (8 / 102), then apply Researcher and
confirm the signal samples/key appear (9 / 779). Return to Visitor: both terrain
and the signal key disappear. Keep a zoomed camera through all changes.

Manually enable a nondefault layer, verify the Customized label, apply and reopen.
Hide all layers, confirm basemap/location controls remain usable, then reset a
preset. Retry GIS after an API failure, replace the catalog while a draft exists,
and restart the provider to verify the lifecycle above. Preset names must never
alter authentication, data access or recipients.

Regression tests use the committed ten-layer dataset for counts/membership and
cover preset/reset/custom/all-hidden, Done/Back, no GPS/refetch/refit, single-source
terrain/fallback, unknown/new layers, failure/retry, obsolete drafts and session
restart. Run `pnpm verify`; native execution and JavaScript exports remain separate
evidence. The repository's existing uncommitted terrain-source chooser work is
preserved outside this stack and must be reconciled when its parent changes land.

### Completed checks — November 13, 2026

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
