/** A program day as the next-day picker needs it: identity + 0-based order. */
export interface ProgramDayRef {
  id: string
  position: number
}

/**
 * Picks the day a user should train next within the current program week: the
 * lowest-position day with no workout logged at that week. Gaps fill first
 * (skipping day 1 keeps it "next" until done). When every day of the week is
 * logged — which `nextProgramWeek` only reports for a finished mesocycle re-
 * running its final week — the cycle wraps back to the first day. Null only
 * when the program has no days.
 */
export function pickNextProgramDay<T extends ProgramDayRef>(
  days: readonly T[],
  loggedDayIds: ReadonlySet<string>,
): T | null {
  if (days.length === 0) return null
  const ordered = [...days].sort((a, b) => a.position - b.position)
  return ordered.find((d) => !loggedDayIds.has(d.id)) ?? ordered[0]
}
