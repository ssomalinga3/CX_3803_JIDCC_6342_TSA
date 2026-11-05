/** Future trail-network attributes stored in gis_feature.properties, not new tables.
 * Type-only imports are safe for mobile. Existing source/demo features remain valid.
 */
export type TrailDifficulty = 'easy' | 'moderate' | 'difficult';
export type LandmarkKind =
  | 'parking'
  | 'bridge'
  | 'picnic_area'
  | 'outdoor_classroom'
  | 'historical_site'
  | 'cultural_feature'
  | 'rock_outcrop'
  | 'specimen_tree'
  | 'wildlife_viewing_area'
  | 'waterfall'
  | 'trailhead'
  | 'junction'
  | 'spring';

interface CommonProperties {
  name: string;
  source_url?: string;
  description?: string;
}

export type TrailNetworkProperties = CommonProperties &
  (
    | {
        feature_kind: 'trail';
        /** Multiple segment features may share a trail_id; feature IDs remain unique. */
        trail_id: string;
        /** Missing attributes stay absent, rather than inferred from the reference photo. */
        difficulty?: TrailDifficulty;
        color?: string;
        length_m?: number;
        surface_type?: string;
      }
    | { feature_kind: 'landmark'; landmark_kind: LandmarkKind }
    | { feature_kind: 'boundary'; boundary_kind: 'preserve' | 'protective' }
    | { feature_kind: 'water'; water_kind: 'stream' | 'water_body' }
    | { feature_kind: 'natural_area' | 'road' }
  );

/** Rendering/import contract; spatial validity is still checked by GIS ingestion/PostGIS. */
export const trailNetworkGeometryTypes = {
  trail: ['LineString', 'MultiLineString'],
  landmark: ['Point', 'MultiPoint'],
  boundary: ['Polygon', 'MultiPolygon'],
  water: ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'],
  natural_area: ['Polygon', 'MultiPolygon'],
  road: ['LineString', 'MultiLineString'],
} as const;
