CREATE TABLE "program_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "program_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_day_id" uuid NOT NULL,
	"wger_exercise_id" integer NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"progression" jsonb
);
--> statement-breakpoint
CREATE TABLE "program_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_exercise_id" uuid NOT NULL,
	"set_number" integer NOT NULL,
	"set_type" text DEFAULT 'working' NOT NULL,
	"metric_mode" text DEFAULT 'reps_weight' NOT NULL,
	"rep_min" integer,
	"rep_max" integer,
	"rir" integer,
	"rpe" numeric(3, 1),
	"suggested_load_kg" numeric(6, 2),
	"tempo" text,
	"duration_sec" integer,
	"distance_m" numeric(9, 2),
	"technique" jsonb,
	-- DEFERRABLE INITIALLY DEFERRED (hand-edited; drizzle-kit can't emit it, same as
	-- sets in 0002): uniqueness of (program_exercise_id, set_number) is checked at
	-- COMMIT, so a future in-place renumber (Phase 4 reorder/remove) that transiently
	-- collides mid-statement still commits, while two concurrent inserts of the same
	-- number are still rejected.
	CONSTRAINT "program_sets_exercise_set_number_unique" UNIQUE("program_exercise_id","set_number") DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"mesocycle_weeks" integer DEFAULT 1 NOT NULL,
	"deload_week" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "metric_mode" text DEFAULT 'reps_weight' NOT NULL;--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "duration_sec" integer;--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "distance_m" numeric(9, 2);--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "program_day_id" uuid;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "program_week" integer;--> statement-breakpoint
ALTER TABLE "program_days" ADD CONSTRAINT "program_days_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_program_day_id_program_days_id_fk" FOREIGN KEY ("program_day_id") REFERENCES "public"."program_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_sets" ADD CONSTRAINT "program_sets_program_exercise_id_program_exercises_id_fk" FOREIGN KEY ("program_exercise_id") REFERENCES "public"."program_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "programs_user_id_idx" ON "programs" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_program_day_id_program_days_id_fk" FOREIGN KEY ("program_day_id") REFERENCES "public"."program_days"("id") ON DELETE set null ON UPDATE no action;