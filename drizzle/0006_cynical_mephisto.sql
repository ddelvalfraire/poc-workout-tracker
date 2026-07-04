CREATE TABLE "custom_exercises" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "custom_exercises_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"equipment" text[],
	"muscles" text[],
	"muscles_secondary" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_exercises_user_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
ALTER TABLE "program_exercises" ADD COLUMN "source" text DEFAULT 'wger' NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD COLUMN "source" text DEFAULT 'wger' NOT NULL;--> statement-breakpoint
CREATE INDEX "custom_exercises_user_id_idx" ON "custom_exercises" USING btree ("user_id");--> statement-breakpoint
-- Negative-ID stopgap guard (hand-edited): the spike's negative-ID convention
-- was cleaned up and zero rows exist (verified 2026-07-04). A real backfill
-- can't synthesize a valid category, so if this ever fires, migrate the rows
-- by hand into custom_exercises first. Runs before the CHECK constraints below
-- (which would also reject such rows) so this clearer error surfaces first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "workout_exercises" WHERE "wger_exercise_id" <= 0)
     OR EXISTS (SELECT 1 FROM "program_exercises" WHERE "wger_exercise_id" <= 0) THEN
    RAISE EXCEPTION 'negative/zero wger_exercise_id rows exist; backfill them into custom_exercises before migrating';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_wger_id_positive" CHECK ("program_exercises"."wger_exercise_id" > 0);--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_wger_id_positive" CHECK ("workout_exercises"."wger_exercise_id" > 0);