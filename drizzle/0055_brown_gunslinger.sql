ALTER TABLE "program_days" ADD COLUMN "slot_key" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "program_day_slot_key" uuid;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "program_day_name" text;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "program_day_position" integer;--> statement-breakpoint
CREATE INDEX "workouts_program_day_slot_key_idx" ON "workouts" USING btree ("program_day_slot_key");--> statement-breakpoint
ALTER TABLE "program_days" ADD CONSTRAINT "program_days_slot_key_unique" UNIQUE("slot_key");