import { sql } from 'drizzle-orm';
import { boolean, check, customType, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

// Generic geometry preserves flexibility across points, lines, polygons and multi-geometries.
const geometry = customType<{ data: string }>({ dataType: () => 'geometry(Geometry,4326)' });

export const gisLayer = pgTable(
  'gis_layer',
  {
    layerId: text('layer_id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    layerType: text('layer_type').notNull(),
    pillar: text('pillar'),
    isPublic: boolean('is_public').notNull().default(false),
    source: text('source').notNull(),
    isDemo: boolean('is_demo').notNull().default(false),
  },
  (table) => [
    check(
      'gis_layer_pillar',
      sql`${table.pillar} IN ('Human', 'Social', 'Environmental', 'Economic')`,
    ),
  ],
);

export const gisFeature = pgTable(
  'gis_feature',
  {
    featureId: text('feature_id').primaryKey(),
    layerId: text('layer_id')
      .notNull()
      .references(() => gisLayer.layerId),
    geometry: geometry('geometry').notNull(),
    properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index('gis_feature_geometry_gist').using('gist', table.geometry),
    index('gis_feature_layer_idx').on(table.layerId),
    check(
      'gis_feature_valid_geometry',
      sql`ST_IsValid(${table.geometry}) AND NOT ST_IsEmpty(${table.geometry})`,
    ),
    check('gis_feature_properties_object', sql`jsonb_typeof(${table.properties}) = 'object'`),
  ],
);
