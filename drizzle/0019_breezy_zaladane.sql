ALTER TABLE "workout_exercises" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD COLUMN "skipped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "notes" text;