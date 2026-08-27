-- Durable-provenance data migration: give the workouts that ALREADY point at a
-- program day the slot key of the day they point at.
--
-- This copies a fact the database currently holds (the live program_day_id
-- link) into the column that survives a full-replace save. Without it, every
-- session logged before this deploy would be orphaned by the very next save
-- from /programs/[id]/edit — the new re-attach can only heal rows that carry a
-- slot key, so the backfill is what makes the fix retroactive for links that
-- are still intact.
--
-- What is deliberately NOT backfilled:
--
--   * workouts whose program_day_id is already NULL. Some of those were nulled
--     by past full-replace saves, and the audit log cannot say which day they
--     belonged to (program_events' upsert_program payload is only
--     { after: { name, status } } — no tree, no ids). Any reconstruction would
--     be a guess stored in a column reads treat as recorded fact. Null is
--     honest; a wrong day is not.
--
--   * program_day_name / program_day_position. Those columns mean "what this
--     day was called WHEN IT WAS TRAINED". Today's name is not evidence of
--     that — the plan may have been renamed or reordered since — so they stay
--     null on historical rows and are stamped only at instantiation from here
--     on. Readers fall back to the live day, exactly as they do today.
--
-- Idempotent: re-running only re-writes the same value.
UPDATE "workouts" w
SET "program_day_slot_key" = d."slot_key"
FROM "program_days" d
WHERE w."program_day_id" = d."id"
  AND w."program_day_slot_key" IS DISTINCT FROM d."slot_key";
