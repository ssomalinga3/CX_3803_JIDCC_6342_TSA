/** Public API contract; coordinates always use longitude, latitude (SRID 4326). */
export type Position = [number, number, ...number[]];
export type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'MultiPoint' | 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString' | 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] }
  | { type: 'GeometryCollection'; geometries: Geometry[] };
export interface FeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id: string;
    geometry: Geometry;
    properties: Record<string, unknown>;
  }[];
}
export interface Layer {
  layerId: string;
  name: string;
  description: string;
  layerType: string;
  pillar: string | null;
  source: string;
  isDemo: boolean;
  featuresUrl: string;
}
export interface LayerCatalog {
  layers: Layer[];
}
export type Bbox = [number, number, number, number];
export interface LayersRepository {
  listPublicLayers(): Promise<LayerCatalog>;
  getPublicLayerFeatures(layerId: string, bbox?: Bbox): Promise<FeatureCollection | null>;
}
