CREATE TABLE "program_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb
);
--> statement-breakpoint
ALTER TABLE "program_events" ADD CONSTRAINT "program_events_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "program_events_program_occurred_idx" ON "program_events" USING btree ("program_id","occurred_at" DESC NULLS LAST);