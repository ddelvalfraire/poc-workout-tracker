export { duplicateProgramDay } from './program-bulk-day'
export { duplicateProgramWeek, fillProgramWeeksRight } from './program-bulk-week'
export {
  applyProgramSetScheme,
  fillProgramSetsDown,
  type FillDownScope,
  type SchemeSetRow,
} from './program-bulk-sets'
export { applyProgressionToScope, type ProgressionScope } from './program-bulk-progression'
export type { SetTargets } from './program-bulk-shared'

/**
 * BULK program ops — the primitives behind the authoring affordances that were
 * drawn before anything could serve them: duplicate day, duplicate week, fill
 * down, fill right, quick-entry scheme apply, and "also apply to" progression
 * scopes.
 *
 * WHY THESE ARE OPS AND NOT CLIENT LOOPS. Every one of them is an unbounded
 * fan-out over single-item patches: duplicating a 6-exercise day is ~30 writes,
 * filling a rule across a program is one per exercise. Expressed as N patches
 * they blow through MAX_PROPOSAL_PATCHES (20, lib/patch-proposal.ts) on any
 * real program, and — worse — a client loop has no transaction, so a failure
 * halfway leaves a half-duplicated day behind. Each function here is ONE
 * transaction with ONE `program_events` row, so it costs ONE slot wherever a
 * batch ceiling applies and can never commit partially.
 *
 * Conventions are the sibling module's (db/program-patches.ts) verbatim:
 * ownership through the join chain to `programs.user_id`; `null` = not
 * owned/found; `ProgramPatchError` = a valid address with an invalid edit;
 * every success bumps `programs.updatedAt` and appends one actor-attributed
 * event inside the same transaction. All of that machinery is shared with the
 * granular ops and lives in db/program-ownership.ts.
 *
 * THIS FILE IS THE FRONT DOOR, NOT THE IMPLEMENTATION. The ops grew past the
 * 800-line cap together, so each now sits with the rows it actually writes:
 *
 *   program-bulk-day.ts          duplicateProgramDay       (the whole subtree)
 *   program-bulk-week.ts         duplicateProgramWeek,     (program_set_overrides)
 *                                fillProgramWeeksRight
 *   program-bulk-sets.ts         fillProgramSetsDown,      (program_sets)
 *                                applyProgramSetScheme
 *   program-bulk-progression.ts  applyProgressionToScope   (program_exercises.progression)
 *   program-bulk-shared.ts       the target-field vocabulary they copy WITH
 *
 * The barrel stays because `db/program-bulk` is the name the tool layer, the
 * specs and the change log already use for this capability; splitting the
 * implementation should not scatter that one import across four. Import an op
 * from here, not from the file it happens to live in today.
 */
