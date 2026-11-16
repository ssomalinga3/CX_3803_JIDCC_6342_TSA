import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

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

const observationPoint = customType<{ data: string }>({ dataType: () => 'geometry(Point,4326)' });

export const observation = pgTable(
  'observation',
  {
    observationId: uuid('observation_id').primaryKey().defaultRandom(),
    clientSubmissionId: uuid('client_submission_id').notNull().unique(),
    accountId: text('account_id'),
    guestSecretDigest: text('guest_secret_digest'),
    payloadDigest: text('payload_digest').notNull(),
    categoryId: text('category_id').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    location: observationPoint('location'),
    locationUnavailableReason: text('location_unavailable_reason'),
    note: text('note'),
    deliveryMode: text('delivery_mode').notNull(),
    recipients: text('recipients').array().notNull(),
  },
  (table) => [
    check(
      'observation_owner_check',
      sql`(${table.accountId} IS NOT NULL AND length(trim(${table.accountId})) > 0 AND ${table.guestSecretDigest} IS NULL)
        OR (${table.accountId} IS NULL AND ${table.guestSecretDigest} IS NOT NULL AND ${table.guestSecretDigest} ~ '^[0-9a-f]{64}$')`,
    ),
    check('observation_payload_digest_check', sql`${table.payloadDigest} ~ '^[0-9a-f]{64}$'`),
    check(
      'observation_location_check',
      sql`(${table.location} IS NOT NULL AND ${table.locationUnavailableReason} IS NULL
        AND NOT ST_IsEmpty(${table.location})
        AND ST_X(${table.location}) BETWEEN -180 AND 180
        AND ST_Y(${table.location}) BETWEEN -90 AND 90)
        OR (${table.location} IS NULL AND ${table.locationUnavailableReason} IS NOT NULL
        AND ${table.locationUnavailableReason} IN ('permission_denied', 'unavailable', 'not_shared'))`,
    ),
    check(
      'observation_delivery_check',
      sql`array_position(${table.recipients}, NULL) IS NULL
        AND array_position(${table.recipients}, '') IS NULL
        AND ((${table.deliveryMode} = 'park' AND cardinality(${table.recipients}) = 1)
          OR (${table.deliveryMode} = 'custom' AND cardinality(${table.recipients}) > 0))`,
    ),
  ],
);

export const observationImage = pgTable(
  'observation_image',
  {
    observationId: uuid('observation_id')
      .notNull()
      .references(() => observation.observationId, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    objectKey: text('object_key').notNull().unique(),
  },
  (table) => [
    primaryKey({ columns: [table.observationId, table.position] }),
    check('observation_image_position_check', sql`${table.position} >= 0`),
    check('observation_image_object_key_check', sql`length(trim(${table.objectKey})) > 0`),
  ],
);
