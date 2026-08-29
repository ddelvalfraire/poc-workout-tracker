/** The one field the decision needs; generic so the DB's NextProgramDay (or a
 *  test stub) fits without this module importing the db layer. */
export interface UpNextSource {
  blockComplete: boolean
}

/** Which follow-up the just-finished summary shows under the celebration. */
export type FinishUpNext<T extends UpNextSource> =
  | { kind: 'none' }
  | { kind: 'next-day'; next: T }
  | { kind: 'block-complete'; next: T }

/**
 * Decides the up-next state for a just-finished workout. Quick-log sessions
 * (no program provenance) and program orphans (day deleted, program archived,
 * or a different program active) get nothing — a wrong suggestion is worse
 * than none. A finished block outranks the next-day rotation: the completed
 * mesocycle is the story, not the re-runnable final week.
 */
export function resolveFinishUpNext<T extends UpNextSource>(
  programDayId: string | null,
  next: T | null,
): FinishUpNext<T> {
  if (programDayId === null || next === null) return { kind: 'none' }
  if (next.blockComplete) return { kind: 'block-complete', next }
  return { kind: 'next-day', next }
}
