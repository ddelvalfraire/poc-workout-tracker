-- Notes v2 data migration: move the legacy column tiers into the notes table.
--
-- workouts.notes            -> workout-anchored rows (no snapshot: session notes)
-- workout_exercises.notes   -> exercise-anchored rows with the {exerciseName}
--                              snapshot every set/exercise-anchored note carries
--
-- author = 'user' (the only author that ever wrote these), created_at/updated_at
-- = the workout's started_at as the best-effort authoring moment. Blank-only
-- bodies are skipped — parseNotes never persisted them, but imports predating
-- the trim rule could have.
--
-- The old columns are KEPT (rollback safety) but from this migration on the
-- app neither writes nor reads them; the notes table is the source of truth.
-- The identity exercise_notes table is untouched (different animal).
INSERT INTO "notes" ("user_id", "author", "body", "workout_id", "created_at", "updated_at")
SELECT w."user_id", 'user', btrim(w."notes"), w."id", w."started_at", w."started_at"
FROM "workouts" w
WHERE w."notes" IS NOT NULL AND btrim(w."notes") <> '';--> statement-breakpoint
INSERT INTO "notes" ("user_id", "author", "body", "workout_exercise_id", "anchor_snapshot", "created_at", "updated_at")
SELECT w."user_id", 'user', btrim(we."notes"), we."id", jsonb_build_object('exerciseName', we."name"), w."started_at", w."started_at"
FROM "workout_exercises" we
JOIN "workouts" w ON w."id" = we."workout_id"
WHERE we."notes" IS NOT NULL AND btrim(we."notes") <> '';
