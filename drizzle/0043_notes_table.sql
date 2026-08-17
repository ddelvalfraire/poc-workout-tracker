CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"author" text DEFAULT 'user' NOT NULL,
	"body" text NOT NULL,
	"program_id" uuid,
	"workout_id" uuid,
	"workout_exercise_id" uuid,
	"set_id" uuid,
	"anchor_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_exactly_one_anchor" CHECK (num_nonnulls("notes"."program_id", "notes"."workout_id", "notes"."workout_exercise_id", "notes"."set_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_workout_exercise_id_workout_exercises_id_fk" FOREIGN KEY ("workout_exercise_id") REFERENCES "public"."workout_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notes_user_created_idx" ON "notes" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notes_program_id_idx" ON "notes" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "notes_workout_id_idx" ON "notes" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "notes_workout_exercise_id_idx" ON "notes" USING btree ("workout_exercise_id");--> statement-breakpoint
CREATE INDEX "notes_set_id_idx" ON "notes" USING btree ("set_id");