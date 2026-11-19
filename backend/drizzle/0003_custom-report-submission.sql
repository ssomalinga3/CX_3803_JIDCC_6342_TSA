CREATE TABLE "report_notification" (
	"notification_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"observation_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_notification_state" CHECK ("report_notification"."state" IN ('pending','sending','delivered','uncertain','failed')),
	CONSTRAINT "report_notification_attempts" CHECK ("report_notification"."attempts" >= 0),
	CONSTRAINT "report_notification_recipient" CHECK (length(trim("report_notification"."recipient")) > 0)
);
--> statement-breakpoint
CREATE TABLE "report_submission" (
	"client_submission_id" uuid PRIMARY KEY NOT NULL,
	"guest_secret_digest" text NOT NULL,
	"payload_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_submission_guest_digest" CHECK ("report_submission"."guest_secret_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "report_submission_payload_digest" CHECK ("report_submission"."payload_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "report_upload_attempt" (
	"attempt_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_submission_id" uuid NOT NULL,
	"state" text DEFAULT 'uploading' NOT NULL,
	"object_keys" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_upload_attempt_state" CHECK ("report_upload_attempt"."state" IN ('uploading','abandoned','accepted')),
	CONSTRAINT "report_upload_attempt_keys" CHECK (cardinality("report_upload_attempt"."object_keys") <= 3 AND array_position("report_upload_attempt"."object_keys", NULL) IS NULL)
);
--> statement-breakpoint
ALTER TABLE "report_notification" ADD CONSTRAINT "report_notification_observation_id_observation_observation_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observation"("observation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_upload_attempt" ADD CONSTRAINT "report_upload_attempt_client_submission_id_report_submission_client_submission_id_fk" FOREIGN KEY ("client_submission_id") REFERENCES "public"."report_submission"("client_submission_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_notification_observation_recipient" ON "report_notification" USING btree ("observation_id","recipient");--> statement-breakpoint
CREATE UNIQUE INDEX "report_upload_attempt_one_active" ON "report_upload_attempt" USING btree ("client_submission_id") WHERE "report_upload_attempt"."state" = 'uploading';--> statement-breakpoint
CREATE INDEX "report_upload_attempt_submission_idx" ON "report_upload_attempt" USING btree ("client_submission_id");