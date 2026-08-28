-- The technique triple (technique_kind, technique_group, stage_index) is
-- all-or-nothing, enforced by the DATABASE rather than only by the write paths.
--
-- Every writer already treats it that way: updateWorkout (db/workouts.ts)
-- spreads all three columns or none, and instantiation (db/prescriptions.ts)
-- stamps all three from one `techniqueStage`. But a partial row was legal, and
-- its two readers disagreed about what one means:
--
--   * `rowTechnique` (db/muscle-volume.ts) needs only kind + stage_index — it
--     deliberately ignores the group, because the stage index alone carries
--     the hard-set weight — so a group-less stage row counts as 0.5 of a set.
--   * `detailToDraft` (app/workout/new/workout-draft.ts) requires all three and
--     degrades anything else to an ordinary set, worth 1.0.
--
-- Same row, two answers. Making the shape a constraint is what stops that,
-- the way notes_exactly_one_anchor (0043) does for the note anchors.
--
-- The repair below runs FIRST and is written for a table that should have no
-- partial rows at all (0051 added the columns; no writer since can produce
-- one). If any exist — a hand-edited row, an older client — they are cleared
-- to an ordinary set rather than guessed into a group: that is already what
-- the logger's read path does with them, so this only makes the storage agree
-- with the reading, and a fabricated group key would invent a set boundary
-- the lifter never logged. Idempotent: re-running matches nothing.
UPDATE "sets"
SET "technique_kind" = NULL,
    "technique_group" = NULL,
    "stage_index" = NULL
WHERE num_nonnulls("technique_kind", "technique_group", "stage_index") NOT IN (0, 3);
--> statement-breakpoint
-- Added NOT VALID, then validated as a SEPARATE statement. A plain
-- ADD CONSTRAINT ... CHECK validates by scanning the whole table while holding
-- ACCESS EXCLUSIVE on it, which blocks every read and write to `sets` — the
-- app's highest-write-volume table, one row per logged set for every user —
-- for the length of the scan. Adding it NOT VALID is metadata-only and
-- instant; VALIDATE CONSTRAINT then does the scan under SHARE UPDATE
-- EXCLUSIVE, which lets concurrent reads and writes through. The end state is
-- identical to the one-statement form (a fully valid, enforced constraint), so
-- the drizzle snapshot is the same either way; new rows are checked from the
-- moment the constraint exists, not from when validation finishes.
ALTER TABLE "sets" ADD CONSTRAINT "sets_technique_all_or_none" CHECK (num_nonnulls("sets"."technique_kind", "sets"."technique_group", "sets"."stage_index") in (0, 3)) NOT VALID;--> statement-breakpoint
ALTER TABLE "sets" VALIDATE CONSTRAINT "sets_technique_all_or_none";
