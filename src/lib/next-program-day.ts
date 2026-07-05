/** A program day as the next-day picker needs it: identity + 0-based order. */
export interface ProgramDayRef {
  id: string
  position: number
}

/**
 * Picks the day a user should train next within the current program week:
 * rotation with wrap-around make-up. The program is a cycle, so the next day
 * is the first unlogged day *after* the highest-position day already logged
 * this week (doing Pull suggests Legs, not a return to Upper). Once past the
 * end, the pick wraps to the earliest unlogged day so skipped days still get
 * made up before the week can advance. When every day of the week is logged —
 * which `nextProgramWeek` only reports for a finished mesocycle re-running its
 * final week — the cycle wraps back to the first day. Null only when the
 * program has no days.
 */
export function pickNextProgramDay<T extends ProgramDayRef>(
  days: readonly T[],
  loggedDayIds: ReadonlySet<string>,
): T | null {
  if (days.length === 0) return null
  const ordered = [...days].sort((a, b) => a.position - b.position)
  const lastTrained = ordered.reduce(
    (max, d) => (loggedDayIds.has(d.id) ? Math.max(max, d.position) : max),
    -Infinity,
  )
  return (
    ordered.find((d) => d.position > lastTrained && !loggedDayIds.has(d.id)) ??
    ordered.find((d) => !loggedDayIds.has(d.id)) ??
    ordered[0]
  )
}
