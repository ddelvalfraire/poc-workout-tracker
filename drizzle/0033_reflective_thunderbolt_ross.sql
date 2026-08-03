CREATE TABLE "workout_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "workout_shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "workout_shares" ADD CONSTRAINT "workout_shares_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workout_shares_workout_id_idx" ON "workout_shares" USING btree ("workout_id");