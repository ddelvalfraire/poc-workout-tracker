/**
 * Session pulse — the "14/20 working sets" readout by the header clock and
 * the volt progress fill on the sticky bar. Pure derivation over the draft
 * (zero new queries), extracted so the counting rules unit-test alone.
 */

/** The draft fields the pulse reads (matches DraftExercise/DraftSet). */
export interface PulseExercise {
  skipped: boolean
  sets: readonly { completed: boolean; tag: string }[]
}

export interface SessionPulse {
  completed: number
  total: number
}

/**
 * Completed/total WORKING sets across non-skipped exercises. Warm-ups are
 * excluded to match scoring semantics (pr-detection and exercise stats skip
 * `tag === 'warmup'` — a warm-up never scores, so it never counts toward the
 * pulse either); skipped exercises are opted out wholesale, mirroring the
 * isSessionDone rule.
 */
export function sessionPulse(exercises: readonly PulseExercise[]): SessionPulse {
  let completed = 0
  let total = 0
  for (const exercise of exercises) {
    if (exercise.skipped) continue
    for (const set of exercise.sets) {
      if (set.tag === 'warmup') continue
      total++
      if (set.completed) completed++
    }
  }
  return { completed, total }
}

/**
 * Sticky-bar Next-up gate, loosened from "only while resting": the glance
 * shows once the session is underway (≥1 completed set of any tag) OR there
 * is more than one exercise to navigate between. A single-exercise session
 * with nothing done yet has nothing to glance at — the one card IS the
 * screen.
 */
export function shouldShowNextUp(
  exercises: readonly { sets: readonly { completed: boolean }[] }[],
): boolean {
  if (exercises.length > 1) return true
  return exercises.some((exercise) => exercise.sets.some((set) => set.completed))
}
