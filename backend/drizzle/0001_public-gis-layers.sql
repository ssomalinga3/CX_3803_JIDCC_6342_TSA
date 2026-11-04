CREATE TABLE "gis_feature" (
	"feature_id" text PRIMARY KEY NOT NULL,
	"layer_id" text NOT NULL,
	"geometry" geometry(Geometry,4326) NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "gis_feature_valid_geometry" CHECK (ST_IsValid("gis_feature"."geometry") AND NOT ST_IsEmpty("gis_feature"."geometry")),
	CONSTRAINT "gis_feature_properties_object" CHECK (jsonb_typeof("gis_feature"."properties") = 'object')
);
--> statement-breakpoint
CREATE TABLE "gis_layer" (
	"layer_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"layer_type" text NOT NULL,
	"pillar" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	CONSTRAINT "gis_layer_pillar" CHECK ("gis_layer"."pillar" IN ('Human', 'Social', 'Environmental', 'Economic'))
);
--> statement-breakpoint
ALTER TABLE "gis_feature" ADD CONSTRAINT "gis_feature_layer_id_gis_layer_layer_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."gis_layer"("layer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gis_feature_geometry_gist" ON "gis_feature" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "gis_feature_layer_idx" ON "gis_feature" USING btree ("layer_id");