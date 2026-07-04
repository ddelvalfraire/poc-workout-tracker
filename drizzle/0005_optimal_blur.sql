CREATE TABLE "program_exercise_muscles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_exercise_id" uuid NOT NULL,
	"muscle" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "program_exercise_muscles_unique" UNIQUE("program_exercise_id","muscle")
);
--> statement-breakpoint
CREATE TABLE "program_set_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_set_id" uuid NOT NULL,
	"week" integer NOT NULL,
	"rep_min" integer,
	"rep_max" integer,
	"rir" integer,
	"rpe" numeric(3, 1),
	"suggested_load_kg" numeric(6, 2),
	"tempo" text,
	"duration_sec" integer,
	"distance_m" numeric(9, 2),
	"technique" jsonb,
	CONSTRAINT "program_set_overrides_set_week_unique" UNIQUE("program_set_id","week")
);
--> statement-breakpoint
ALTER TABLE "program_exercises" ADD COLUMN "superset_group" integer;--> statement-breakpoint
ALTER TABLE "program_exercise_muscles" ADD CONSTRAINT "program_exercise_muscles_program_exercise_id_program_exercises_id_fk" FOREIGN KEY ("program_exercise_id") REFERENCES "public"."program_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_set_overrides" ADD CONSTRAINT "program_set_overrides_program_set_id_program_sets_id_fk" FOREIGN KEY ("program_set_id") REFERENCES "public"."program_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "program_exercise_muscles_exercise_idx" ON "program_exercise_muscles" USING btree ("program_exercise_id");