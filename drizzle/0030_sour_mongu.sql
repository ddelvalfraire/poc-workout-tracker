CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"file_name" text,
	"workout_count" integer NOT NULL,
	"set_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
CREATE INDEX "import_batches_user_id_idx" ON "import_batches" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;