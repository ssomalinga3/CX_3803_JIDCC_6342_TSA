CREATE TABLE "observation" (
	"observation_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_submission_id" uuid NOT NULL,
	"account_id" text,
	"guest_secret_digest" text,
	"payload_digest" text NOT NULL,
	"category_id" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"location" geometry(Point,4326),
	"location_unavailable_reason" text,
	"note" text,
	"delivery_mode" text NOT NULL,
	"recipients" text[] NOT NULL,
	CONSTRAINT "observation_client_submission_id_unique" UNIQUE("client_submission_id"),
	CONSTRAINT "observation_owner_check" CHECK (("observation"."account_id" IS NOT NULL AND length(trim("observation"."account_id")) > 0 AND "observation"."guest_secret_digest" IS NULL)
        OR ("observation"."account_id" IS NULL AND "observation"."guest_secret_digest" IS NOT NULL AND "observation"."guest_secret_digest" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "observation_payload_digest_check" CHECK ("observation"."payload_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "observation_location_check" CHECK (("observation"."location" IS NOT NULL AND "observation"."location_unavailable_reason" IS NULL
        AND NOT ST_IsEmpty("observation"."location")
        AND ST_X("observation"."location") BETWEEN -180 AND 180
        AND ST_Y("observation"."location") BETWEEN -90 AND 90)
        OR ("observation"."location" IS NULL AND "observation"."location_unavailable_reason" IS NOT NULL
        AND "observation"."location_unavailable_reason" IN ('permission_denied', 'unavailable', 'not_shared'))),
	CONSTRAINT "observation_delivery_check" CHECK (array_position("observation"."recipients", NULL) IS NULL
        AND array_position("observation"."recipients", '') IS NULL
        AND (("observation"."delivery_mode" = 'park' AND cardinality("observation"."recipients") = 1)
          OR ("observation"."delivery_mode" = 'custom' AND cardinality("observation"."recipients") > 0)))
);
--> statement-breakpoint
CREATE TABLE "observation_image" (
	"observation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"object_key" text NOT NULL,
	CONSTRAINT "observation_image_observation_id_position_pk" PRIMARY KEY("observation_id","position"),
	CONSTRAINT "observation_image_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "observation_image_position_check" CHECK ("observation_image"."position" >= 0),
	CONSTRAINT "observation_image_object_key_check" CHECK (length(trim("observation_image"."object_key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "observation_image" ADD CONSTRAINT "observation_image_observation_id_observation_observation_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observation"("observation_id") ON DELETE cascade ON UPDATE no action;