/**
 * Storybook stand-ins for the `'use server'` action modules.
 *
 * Three components call server actions directly (`UnitToggle`, `NavDrawer`,
 * `SessionConflictDialog`). Importing the real modules into the browser bundle
 * would drag in Drizzle, Postgres and the AuthKit session — none of which belong in a
 * component catalog. `.storybook/main.ts` aliases those specifiers here.
 *
 * Each stub resolves after a short delay so the pending states these
 * components define (`isPending` transitions, disabled buttons, in-flight
 * labels) are actually reachable in a story instead of flashing past.
 *
 * The `satisfies` clauses at the bottom are the point: they are TYPE-ONLY
 * imports of the real modules, erased at build time, so tsc fails if a stub
 * drifts from the signature it stands in for. A stub that returns the wrong
 * shape fails inside a story at call time, which is when nobody is watching.
 */
import type * as AppActions from "@/app/actions";
import type * as ExerciseActions from "@/app/exercises/actions";
import type * as NoteActions from "@/app/notes/actions";
import type { NoteRow } from "@/db/notes";
import type * as ProgramActions from "@/app/programs/actions";
import type * as WorkoutActions from "@/app/workout/actions";

const LATENCY_MS = 600;

function settle<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

/** `@/app/actions` — persists the user's kg/lb preference. */
export async function setWeightUnitAction(unit: unknown): Promise<void> {
  console.info("[storybook] setWeightUnitAction", unit);
  await settle(undefined);
}

/** `@/app/programs/actions` — starts a program day and returns the new workout. */
export async function startProgramDayAction(
  programDayId: unknown,
  week?: unknown,
): Promise<{ workoutId: string; week: number }> {
  console.info("[storybook] startProgramDayAction", programDayId, week);
  return settle({
    workoutId: "storybook-workout",
    week: typeof week === "number" ? week : 1,
  });
}

/** `@/app/workout/actions` — discards an in-progress draft. */
export async function deleteWorkoutDraftAction(key: unknown): Promise<void> {
  console.info("[storybook] deleteWorkoutDraftAction", key);
  await settle(undefined);
}

/** `@/app/workout/actions` — deletes a saved workout. */
export async function deleteWorkoutAction(id: string): Promise<void> {
  console.info("[storybook] deleteWorkoutAction", id);
  await settle(undefined);
}

/* ---------------------------------------------------------------------------
 * The logger surface (Logger/* stories). Every READ stub resolves to
 * null/empty on purpose: a story must show the state its args describe and
 * never data invented here — and the logger is built to render with no
 * history, no plan and no best (that IS its first-session state). Every WRITE
 * stub just logs, so the optimistic paths and pending states still run.
 * ------------------------------------------------------------------------ */

/** `@/app/actions` — persists the plate-calculator gear. */
export async function setEquipmentAction(input: unknown): Promise<void> {
  console.info("[storybook] setEquipmentAction", input);
  await settle(undefined);
}

/** `@/app/actions` — persists the fallback rest target. */
export async function setDefaultRestSecAction(sec: unknown): Promise<void> {
  console.info("[storybook] setDefaultRestSecAction", sec);
  await settle(undefined);
}

/** `@/app/workout/actions` — persists a freshly logged workout. */
export async function saveWorkoutAction(
  input: unknown,
): Promise<{ id: string }> {
  console.info("[storybook] saveWorkoutAction", input);
  return settle({ id: "storybook-workout" });
}

/** `@/app/workout/actions` — persists an edit to an existing workout. */
export async function updateWorkoutAction(
  id: string,
  input: unknown,
): Promise<{ id: string }> {
  console.info("[storybook] updateWorkoutAction", id, input);
  return settle({ id });
}

/** `@/app/workout/actions` — last performance (the Prev chip's ghosts). */
export async function getLastPerformanceAction(
  wgerExerciseId: unknown,
  excludeWorkoutId?: unknown,
  source?: unknown,
): Promise<null> {
  console.info(
    "[storybook] getLastPerformanceAction",
    wgerExerciseId,
    excludeWorkoutId,
    source,
  );
  return settle(null);
}

/** `@/app/workout/actions` — the exercise stats sheet's payload. */
export async function getExerciseSheetAction(
  wgerExerciseId: unknown,
  source?: unknown,
): Promise<null> {
  console.info("[storybook] getExerciseSheetAction", wgerExerciseId, source);
  return settle(null);
}

/** `@/app/workout/actions` — the exercise's best e1RM (the PR badge). */
export async function getExerciseBestAction(
  wgerExerciseId: unknown,
  source?: unknown,
): Promise<number | null> {
  console.info("[storybook] getExerciseBestAction", wgerExerciseId, source);
  return settle(null);
}

/** `@/app/workout/actions` — plan targets for a swapped-in exercise. */
export async function substitutePlanTargetsAction(
  workoutId: unknown,
  originalWgerExerciseId: unknown,
  substituteWgerExerciseId: unknown,
  originalSource?: unknown,
  substituteSource?: unknown,
): Promise<null> {
  console.info(
    "[storybook] substitutePlanTargetsAction",
    workoutId,
    originalWgerExerciseId,
    substituteWgerExerciseId,
    originalSource,
    substituteSource,
  );
  return settle(null);
}

/** `@/app/workout/actions` — makes a swap permanent for the block. */
export async function rememberSwapAction(
  workoutId: unknown,
  originalWgerExerciseId: unknown,
  substitute: { wgerExerciseId: unknown; name: unknown; source?: unknown },
  originalSource?: unknown,
): Promise<void> {
  console.info(
    "[storybook] rememberSwapAction",
    workoutId,
    originalWgerExerciseId,
    substitute,
    originalSource,
  );
  await settle(undefined);
}

/** `@/app/workout/actions` — reads the server-side draft snapshot. */
export async function getWorkoutDraftAction(
  key: unknown,
): Promise<unknown | null> {
  console.info("[storybook] getWorkoutDraftAction", key);
  return settle(null);
}

/** `@/app/workout/actions` — writes the server-side draft snapshot. */
export async function putWorkoutDraftAction(
  key: unknown,
  payload: unknown,
): Promise<void> {
  console.info("[storybook] putWorkoutDraftAction", key, payload);
  await settle(undefined);
}

/** `@/app/notes/actions` — creates one anchored note (notes v2 capture). */
export async function createNoteAction(
  anchor: unknown,
  body: unknown,
  clientKey?: unknown,
): Promise<NoteRow> {
  console.info("[storybook] createNoteAction", anchor, body, clientKey);
  return settle({
    id: "storybook-note",
    userId: "storybook-user",
    author: "user",
    body: typeof body === "string" ? body : "",
    anchorKind: "workout",
    programId: null,
    workoutId: null,
    workoutExerciseId: null,
    setId: null,
    anchorSnapshot: null,
    clientKey: null,
    pinned: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } as NoteRow);
}

/** `@/app/notes/actions` — the post-save batch of captured set notes. */
export async function createSetNotesForWorkoutAction(
  workoutId: unknown,
  entries: unknown,
): Promise<void> {
  console.info("[storybook] createSetNotesForWorkoutAction", workoutId, entries);
  await settle(undefined);
}

/** `@/app/notes/actions` — re-anchors a set note whose set vanished. */
export async function createFallbackSetNoteAction(
  workoutId: unknown,
  body: unknown,
  clientKey: unknown,
): Promise<void> {
  console.info(
    "[storybook] createFallbackSetNoteAction",
    workoutId,
    body,
    clientKey,
  );
  await settle(undefined);
}

/** `@/app/exercises/actions` — mints a custom exercise from the picker. */
export async function createCustomExerciseAction(
  input: unknown,
): Promise<ExerciseActions.CustomExerciseResult> {
  console.info("[storybook] createCustomExerciseAction", input);
  return settle({
    id: 1,
    name: "Storybook Exercise",
    category: "Chest",
    muscles: [],
    musclesSecondary: [],
  });
}

/** `@/app/exercises/actions` — writes the per-exercise identity note. */
export async function upsertExerciseNoteAction(
  source: unknown,
  exerciseId: unknown,
  input: unknown,
): Promise<{ body: string; pinned: boolean }> {
  console.info(
    "[storybook] upsertExerciseNoteAction",
    source,
    exerciseId,
    input,
  );
  const record = (input ?? {}) as { body?: unknown; pinned?: unknown };
  return settle({
    body: typeof record.body === "string" ? record.body : "",
    pinned: record.pinned === true,
  });
}

/** `@/app/exercises/actions` — clears the per-exercise identity note. */
export async function deleteExerciseNoteAction(
  source: unknown,
  exerciseId: unknown,
): Promise<void> {
  console.info("[storybook] deleteExerciseNoteAction", source, exerciseId);
  await settle(undefined);
}

/** `@/app/actions` — ends the session (SignOutButton, drawer footer). */
export async function signOutAction(): Promise<void> {
  console.info("[storybook] signOutAction");
  await settle(undefined);
}

// Compile-time fidelity checks — see the module doc above. Purely type-level:
// no runtime value is produced. A stub whose signature drifts from the action
// it stands in for makes `Matches` resolve to `false`, which fails `Assert`.
type Matches<Stub, Real> = Stub extends Real ? true : false;
type Assert<T extends true> = T;

/**
 * Exported so it counts as used — it exists purely to be type-checked. Each
 * entry must resolve to `true`; a stub that drifts resolves to `false` and
 * fails the `Assert` constraint.
 */
export type MockFidelity = [
  Assert<
    Matches<typeof setWeightUnitAction, typeof AppActions.setWeightUnitAction>
  >,
  Assert<Matches<typeof signOutAction, typeof AppActions.signOutAction>>,
  Assert<
    Matches<
      typeof startProgramDayAction,
      typeof ProgramActions.startProgramDayAction
    >
  >,
  Assert<
    Matches<
      typeof deleteWorkoutDraftAction,
      typeof WorkoutActions.deleteWorkoutDraftAction
    >
  >,
  Assert<
    Matches<
      typeof deleteWorkoutAction,
      typeof WorkoutActions.deleteWorkoutAction
    >
  >,
  Assert<
    Matches<typeof setEquipmentAction, typeof AppActions.setEquipmentAction>
  >,
  Assert<
    Matches<
      typeof setDefaultRestSecAction,
      typeof AppActions.setDefaultRestSecAction
    >
  >,
  Assert<
    Matches<typeof saveWorkoutAction, typeof WorkoutActions.saveWorkoutAction>
  >,
  Assert<
    Matches<
      typeof updateWorkoutAction,
      typeof WorkoutActions.updateWorkoutAction
    >
  >,
  Assert<
    Matches<
      typeof getLastPerformanceAction,
      typeof WorkoutActions.getLastPerformanceAction
    >
  >,
  Assert<
    Matches<
      typeof getExerciseSheetAction,
      typeof WorkoutActions.getExerciseSheetAction
    >
  >,
  Assert<
    Matches<
      typeof getExerciseBestAction,
      typeof WorkoutActions.getExerciseBestAction
    >
  >,
  Assert<
    Matches<
      typeof substitutePlanTargetsAction,
      typeof WorkoutActions.substitutePlanTargetsAction
    >
  >,
  Assert<
    Matches<typeof rememberSwapAction, typeof WorkoutActions.rememberSwapAction>
  >,
  Assert<
    Matches<
      typeof getWorkoutDraftAction,
      typeof WorkoutActions.getWorkoutDraftAction
    >
  >,
  Assert<
    Matches<
      typeof putWorkoutDraftAction,
      typeof WorkoutActions.putWorkoutDraftAction
    >
  >,
  Assert<Matches<typeof createNoteAction, typeof NoteActions.createNoteAction>>,
  Assert<
    Matches<
      typeof createSetNotesForWorkoutAction,
      typeof NoteActions.createSetNotesForWorkoutAction
    >
  >,
  Assert<
    Matches<
      typeof createFallbackSetNoteAction,
      typeof NoteActions.createFallbackSetNoteAction
    >
  >,
  Assert<
    Matches<
      typeof createCustomExerciseAction,
      typeof ExerciseActions.createCustomExerciseAction
    >
  >,
  Assert<
    Matches<
      typeof upsertExerciseNoteAction,
      typeof ExerciseActions.upsertExerciseNoteAction
    >
  >,
  Assert<
    Matches<
      typeof deleteExerciseNoteAction,
      typeof ExerciseActions.deleteExerciseNoteAction
    >
  >,
];
