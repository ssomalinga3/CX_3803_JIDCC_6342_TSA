ALTER TABLE "report_notification" ADD COLUMN "attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "report_notification" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report_notification" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "report_notification" ADD COLUMN "delivered_at" timestamp with time zone;