-- DEFERRABLE INITIALLY DEFERRED: the uniqueness of (workout_exercise_id, set_number)
-- is checked at COMMIT, not per-row. removeSet renumbers higher sets down by one in a
-- single UPDATE that transiently collides mid-statement; deferring lets that transaction
-- reach a consistent final state before the check, while still rejecting two concurrent
-- add_set calls that would commit the same set number.
ALTER TABLE "sets" ADD CONSTRAINT "sets_exercise_set_number_unique" UNIQUE("workout_exercise_id","set_number") DEFERRABLE INITIALLY DEFERRED;
