CREATE TABLE "workout_template_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"wger_exercise_id" integer NOT NULL,
	"source" text DEFAULT 'wger' NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"logging_type" text DEFAULT 'weight_reps' NOT NULL,
	"notes" text,
	"planned_sets" integer DEFAULT 3 NOT NULL,
	"rep_min" integer,
	"rep_max" integer,
	"rest_sec" integer,
	CONSTRAINT "workout_template_exercises_wger_id_positive" CHECK ("workout_template_exercises"."wger_exercise_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "workout_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"author_actor" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workout_template_exercises" ADD CONSTRAINT "workout_template_exercises_template_id_workout_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workout_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workout_template_exercises_template_idx" ON "workout_template_exercises" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "workout_templates_user_id_idx" ON "workout_templates" USING btree ("user_id");