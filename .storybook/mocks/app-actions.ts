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
 */

const LATENCY_MS = 600;

function settle<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

/** `@/app/actions` — persists the user's kg/lb preference. */
export async function setWeightUnitAction(unit: "kg" | "lb"): Promise<void> {
  console.info("[storybook] setWeightUnitAction", unit);
  await settle(undefined);
}

/** `@/app/programs/actions` — starts a program day and returns the new workout. */
export async function startProgramDayAction(
  dayId: string | number,
): Promise<{ workoutId: string }> {
  console.info("[storybook] startProgramDayAction", dayId);
  return settle({ workoutId: "storybook-workout" });
}

/** `@/app/workout/actions` — discards an in-progress draft. */
export async function deleteWorkoutDraftAction(id: unknown): Promise<void> {
  console.info("[storybook] deleteWorkoutDraftAction", id);
  await settle(undefined);
}

/** `@/app/workout/actions` — deletes a saved workout. */
export async function deleteWorkoutAction(id: unknown): Promise<void> {
  console.info("[storybook] deleteWorkoutAction", id);
  await settle(undefined);
}
