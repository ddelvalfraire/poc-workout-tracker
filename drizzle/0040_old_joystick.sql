CREATE TABLE "exercise_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source" text DEFAULT 'wger' NOT NULL,
	"exercise_id" integer NOT NULL,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_notes_user_exercise_unique" UNIQUE("user_id","source","exercise_id"),
	CONSTRAINT "exercise_notes_exercise_id_positive" CHECK ("exercise_notes"."exercise_id" > 0)
);
