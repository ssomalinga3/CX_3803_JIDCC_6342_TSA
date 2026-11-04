# Trail network reference and GIS structure

The project owner supplied this sign photo on November 4, 2026 as the intended
future map-content reference. Figma continues to govern application layout and
interactions; the sign guides trail identity, colors, labels, landmark symbols,
background context and legend content.

![Cascade Springs Nature Preserve trail network sign](references/cascade-springs-trail-network.png)

The original photo is retained as a design/source reference. Its perspective,
scale and terrain artwork are not georeferenced. GIS for this full network will
be supplied later. Do not trace coordinates, infer protective zones, or treat the
previously downloaded My Maps route as all named trails on this sign.

## Inventory awaiting GIS

The [planning catalog](../../data/trail-network/catalog.json) records the sign's
trail names, difficulty labels, approximate color names, layer families and
landmark categories. Every entry is marked `awaiting-gis`. It is not a seed,
GeoJSON collection or API catalog, and no placeholder layers are published.

| Trail / route family | Sign difficulty | Sign color reference |
| --- | --- | --- |
| Springs Trail | Moderate | Orange |
| White Oak Trail | Moderate | Light blue |
| Bigleaf Magnolia Trail | Moderate | Dark green |
| Turkeyfoot/Utoy Creek Trail | Easy, with an asterisk | Blue |
| Battle Ridge Trail | Moderate | Pink |
| West Trail | Difficult | Red |
| Terrace Trail | Moderate | Purple |
| Gateway Trail | Easy | White |
| Spur Trails | Not specified | Black |

Names and legend transcription require reconciliation with incoming GIS. The
sign also mentions a reroute; confirm its current route/conditions with the data
provider. Printed mileages are not loaded as measured geometry lengths. Colors
are descriptive references, not sampled production tokens.

Landmark categories cover parking, bridge, picnic area, outdoor classroom,
historical site, cultural feature, rock outcrop, specimen tree, wildlife viewing
area and waterfall. The catalog also accommodates trailhead, junction and spring
points from the existing downloaded source.

## Storage and exchange

The existing generic `gis_layer` and `gis_feature` tables support the reference:
SRID 4326 points/multipoints, lines/multilines and polygons/multipolygons; flexible
JSON properties; source metadata; public/private layer visibility; and GiST
spatial indexing. No new tables or nullable geometry placeholders are needed.
Use stable layer IDs and globally unique segment/feature IDs. Multiple trail
segments can share a `trail_id` for labels, styling and selection.

[Shared TypeScript attributes](../../backend/src/modules/gis/trail-network.ts)
define the incoming data structure below. These are types and geometry-family
metadata for future ingestion, not a new endpoint or an automatic importer.
Future importers must validate coordinates and these attributes at runtime;
PostGIS still enforces valid, nonempty SRID 4326 geometry. Existing demo/source
properties remain compatible and are not retroactively reclassified.

| Feature kind | Geometry | Additional properties |
| --- | --- | --- |
| `trail` | LineString / MultiLineString | Required `trail_id`; optional `difficulty` (`easy`, `moderate`, `difficult`), hex `color`, `length_m`, `surface_type` |
| `boundary` | Polygon / MultiPolygon | `boundary_kind`: `preserve` or `protective` |
| `landmark` | Point / MultiPoint | `landmark_kind` from the catalog |
| `water` | LineString / MultiLineString / Polygon / MultiPolygon | `water_kind`: `stream` or `water_body` |
| `natural_area` | Polygon / MultiPolygon | Common properties |
| `road` | LineString / MultiLineString | Common properties |

All features carry `name` and `feature_kind`, with optional plain-text
`description` and `source_url`. Missing difficulty, surface, color or measured
length stays absent. Preserve original source fields separately when needed;
confirm source CRS, field mapping, publication permissions and provenance before
import. `cultural_feature` is a landmark category, not a fifth sustainability
pillar. Pillar assignments and protected-layer access remain D-05/D-02 decisions.

## Rendering when GIS arrives

Render natural areas/water and roads as context, preserve/protective boundaries
with distinguishable outlines, named trail strokes above background fills, and
landmark symbols/labels above trails. Trail colors identify routes; difficulty
uses text as well as any visual treatment. White Gateway Trail needs a contrasting
casing. Keep legend colors/symbols and feature details consistent with displayed
features; show unknown difficulty as unknown rather than easy.

The current renderer provides generic polygon, line and point styling. Per-trail
colors and names, category-specific symbols, separate polygon treatments,
legend, layer selection and feature details are future UI work. The new catalog
and types provide their data structure without pretending these interactions
already exist. Device offline downloads and trail-safety calculations remain
separate work.

## Acceptance when data is supplied

1. Reconcile each catalog entry with source IDs, route segments and current
   conditions; retain provider provenance and explicit publication visibility.
2. Validate geometry/CRS, attribute enums and units. Confirm segment topology,
   landmark alignment and preserve/protective polygons against provider evidence.
3. Import transactionally without duplicate IDs; keep incomplete/restricted data
   out of public responses. Unknown attributes must not become safety defaults.
4. Verify PostGIS → API → mobile property preservation, route colors/labels,
   readable trail overlap, landmark symbols, legend and independent layer toggles.
5. Verify fit/pan/zoom, denied location browsing and the agreed offline behavior
   on supported targets when those features are implemented. Field alignment and
   approved safety tolerances are required before claiming navigation safety.

## Structure verification — November 4, 2026

The fresh-database suite passes 47 backend tests, including a test-only round trip
through PostGIS/API for shared route IDs, optional difficulty, color, surface and
length attributes, both boundary kinds, landmark categories and multi-geometries
across the planned feature families. The inventory check confirms all routes are
awaiting GIS and each planned layer matches the shared geometry contract. No
full-network geometry or renderer changes were introduced; future visual/device
acceptance remains pending actual datasets.
