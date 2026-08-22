CREATE TABLE "rc_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"app_user_id" text,
	"environment" text NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "rc_webhook_events_user_idx" ON "rc_webhook_events" USING btree ("app_user_id");--> statement-breakpoint
CREATE INDEX "rc_webhook_events_status_idx" ON "rc_webhook_events" USING btree ("status","received_at");