ALTER TABLE "programs" ADD COLUMN "deload_policy" jsonb;--> statement-breakpoint
UPDATE "program_exercises"
SET "progression" = "progression" || '{"tmBumpTiming":"before-deload"}'::jsonb
WHERE "progression"->>'scheme' = 'amrap-cycle';
