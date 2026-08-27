CREATE TABLE "workout_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"changed" text[] DEFAULT '{}'::text[] NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "original_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workout_events" ADD CONSTRAINT "workout_events_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workout_events_workout_occurred_idx" ON "workout_events" USING btree ("workout_id","occurred_at" DESC NULLS LAST);