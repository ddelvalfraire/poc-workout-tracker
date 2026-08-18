/**
 * Storybook stand-ins for the `'use server'` action modules.
 *
 * Three components call server actions directly (`UnitToggle`, `NavDrawer`,
 * `SessionConflictDialog`). Importing the real modules into the browser bundle
 * would drag in Drizzle, Postgres and Clerk auth — none of which belong in a
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

// Compile-time fidelity checks — see the module doc above.
export const __typeCheck = {
  setWeightUnitAction: setWeightUnitAction satisfies typeof AppActions.setWeightUnitAction,
  startProgramDayAction:
    startProgramDayAction satisfies typeof ProgramActions.startProgramDayAction,
  deleteWorkoutDraftAction:
    deleteWorkoutDraftAction satisfies typeof WorkoutActions.deleteWorkoutDraftAction,
  deleteWorkoutAction: deleteWorkoutAction satisfies typeof WorkoutActions.deleteWorkoutAction,
};
