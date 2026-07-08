ALTER TABLE "user_preferences" ADD COLUMN "bodyweight_kg" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD COLUMN "logging_type" text DEFAULT 'weight_reps' NOT NULL;