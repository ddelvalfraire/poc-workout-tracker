CREATE TABLE "program_patch_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"author_actor" text NOT NULL,
	"summary" text NOT NULL,
	"patches" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "program_patch_proposals" ADD CONSTRAINT "program_patch_proposals_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "program_patch_proposals_program_id_idx" ON "program_patch_proposals" USING btree ("program_id");