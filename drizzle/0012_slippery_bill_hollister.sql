CREATE TABLE "bodyweight_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"weighed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"weight_kg" numeric(5, 2) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bodyweight_logs_user_id_idx" ON "bodyweight_logs" USING btree ("user_id");