-- Backfill: every workout that already exists predates the change log, so its
-- original record was persisted at some point in the past and the only stamp
-- that ever marked it is `completed_at`. Reading it HERE is a one-time
-- historical statement about rows written before this column existed — not the
-- runtime inference this column was added to kill. From this migration on,
-- `original_recorded_at` is written only by the session-scoped writes
-- (saveWorkout / updateWorkout) that mean it, never by a set-level touch.
--
-- Rows with a null `completed_at` stay null: an unfinished session has not
-- been recorded, which is exactly what the column should say.
-- Idempotent: the IS NULL guard makes a replay a no-op.
UPDATE "workouts" SET "original_recorded_at" = "completed_at"
WHERE "completed_at" IS NOT NULL AND "original_recorded_at" IS NULL;
