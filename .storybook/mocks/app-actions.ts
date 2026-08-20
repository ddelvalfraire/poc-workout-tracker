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
];
