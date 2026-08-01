CREATE TABLE "progress_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blob_key_display" text NOT NULL,
	"blob_key_thumb" text NOT NULL,
	"thumb_hash" text NOT NULL,
	"pose" text,
	"note" text
);
--> statement-breakpoint
CREATE INDEX "progress_photos_user_id_taken_at_idx" ON "progress_photos" USING btree ("user_id","taken_at" DESC NULLS LAST);