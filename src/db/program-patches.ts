export {
  setProgramAutoregulation,
  setProgramDeloadPolicy,
  setProgramDietPhase,
  setProgramOvershootPolicy,
  setProgramPlanSync,
} from './program-patches-policy'
export {
  updateProgramMeta,
} from './program-patches-meta'
export {
  setTrainingMax,
  type TrainingMaxReason,
} from './program-patches-training-max'
export {
  addProgramDay,
  moveProgramDay,
  removeProgramDay,
  updateProgramDay,
  type ProgramDayPatch,
} from './program-patches-day'
export {
  addProgramExercise,
  moveProgramExercise,
  removeProgramExercise,
  substituteProgramExercise,
  updateProgramExercise,
  type ProgramExercisePatch,
} from './program-patches-exercise'
export {
  addProgramSet,
  moveProgramSet,
  removeProgramSet,
  syncProgramExerciseLoads,
  updateProgramSet,
  type ProgramSetPatch,
} from './program-patches-set'
export {
  removeProgramSetOverride,
  setProgramSetOverride,
  type ProgramSetOverridePatch,
} from './program-patches-override'

// Re-exported rather than moved out of the public surface: this error is part
// of the patch API that callers already catch, and the split is meant to be
// invisible from outside. See program-ownership.ts for where it now lives.
export { ProgramPatchError } from './program-ownership'


/**
 * Granular patch ops for the program tree — the program twin of the set-level
 * ops in `db/workouts.ts`. Each op addresses one node by `programId` + 0-based
 * positions (+ 1-based `setNumber` at the leaf; + `week` for the Phase-5
 * per-week override ops), runs in one `db.transaction`, and is user-scoped:
 * ownership is enforced through the join chain up to `programs.user_id`, so a
 * caller can never touch another user's program.
 *
 * Two distinct failure channels:
 * - `null` — the addressed node isn't owned or doesn't exist (tool → not-found)
 * - `ProgramPatchError` — the edit itself is invalid (last-set removal, a merge
 *   that breaks the Phase-1 cross-field rules, malformed technique/progression)
 *
 * Every successful op bumps `programs.updatedAt` (the list sort key) AND
 * appends exactly one `program_events` row (the change log — see
 * program-events.ts) inside the same transaction; the required `actor` param
 * says who edited, threaded from the boundary so no call site can forget it.
 * Positions stay 0-based contiguous and setNumbers 1-based
 * contiguous: removes close the gap, moves splice-renumber. All three levels
 * carry a per-parent unique on their ordering column; the splice-renumbers
 * transiently collide with it — safe because the migrations made each one
 * DEFERRABLE INITIALLY DEFERRED (checked at commit).
 *
 * The ownership gates, the transaction plumbing and `ProgramPatchError` itself
 * live one floor down in db/program-ownership.ts, shared with the bulk ops. This
 * module therefore exports OPS AND ONLY OPS — which is what lets the change-log
 * ratchet in program-events-completeness.test.ts run without exceptions.
 */
