CREATE TABLE "trophies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"achieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "trophies_user_id_kind_unique" UNIQUE("user_id","kind")
);
--> statement-breakpoint
CREATE INDEX "trophies_user_id_idx" ON "trophies" USING btree ("user_id");