CREATE TABLE "body_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"site" text NOT NULL,
	"value_cm" numeric(5, 2) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "body_measurements_user_id_measured_at_idx" ON "body_measurements" USING btree ("user_id","measured_at" DESC NULLS LAST);