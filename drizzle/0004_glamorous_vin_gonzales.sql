-- Position uniqueness for the program ordering columns: concurrent appends both
-- read max(position) then insert, so without these constraints two racers could
-- land at the same position and make the position-addressed patch ops ambiguous.
-- DEFERRABLE INITIALLY DEFERRED (hand-edited; drizzle-kit can't emit it, same as
-- sets in 0002 and program_sets in 0003): the Phase-4 move ops splice-renumber
-- in place, which transiently collides mid-transaction; deferring the check to
-- commit lets those renumbers through while still rejecting true duplicates.
ALTER TABLE "program_days" ADD CONSTRAINT "program_days_program_position_unique" UNIQUE("program_id","position") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_day_position_unique" UNIQUE("program_day_id","position") DEFERRABLE INITIALLY DEFERRED;
