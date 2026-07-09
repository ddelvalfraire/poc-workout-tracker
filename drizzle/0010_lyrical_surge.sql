ALTER TABLE "program_set_overrides" ADD COLUMN "rest_sec" integer;--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN "rest_sec" integer;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "default_rest_sec" integer;