-- LOCK NOTE (read before applying): the first statement REWRITES the table.
-- Postgres skips the rewrite for ADD COLUMN ... DEFAULT only when the default
-- is a CONSTANT it can store once in the catalog. gen_random_uuid() is
-- volatile — every row needs its own value — so this ADD COLUMN rewrites all of
-- program_days while holding ACCESS EXCLUSIVE on it, blocking reads and writes
-- for the duration. The table is small (one row per day per program), so the
-- pause is expected to be brief, but it is a rewrite, not a catalog-only edit.
-- The remaining statements are catalog-only, except the UNIQUE constraint,
-- which builds an index under the same lock.
ALTER TABLE "program_days" ADD COLUMN "slot_key" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "program_day_slot_key" uuid;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "program_day_name" text;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "program_day_position" integer;--> statement-breakpoint
CREATE INDEX "workouts_program_day_slot_key_idx" ON "workouts" USING btree ("program_day_slot_key");--> statement-breakpoint
ALTER TABLE "program_days" ADD CONSTRAINT "program_days_slot_key_unique" UNIQUE("slot_key");