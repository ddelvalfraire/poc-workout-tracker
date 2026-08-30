import type { ExerciseSource } from '@/lib/exercises/custom-exercise-input'

/**
 * The create-from-swap return leg (#218): `/exercises/new` finishes by writing
 * ONE pick instruction here and navigating back; the logger consumes it on
 * mount and routes it through its existing swap/add paths (guard dialog,
 * substitute plan targets, use-for-block prompt, undo — exactly a normal
 * pick). sessionStorage, not a query param: the logger's URL stays canonical
 * (`/workout/new` and `/workout/[id]/edit` both host it), a reload can't
 * replay the swap, and per-tab scoping matches the draft's nav stack.
 *
 * Parsing is a trust boundary in the `parseDraftPayload` spirit: the value
 * round-trips through storage a different page wrote, so the reader
 * re-validates the full shape and rejects rather than coerces.
 */

/** The picked identity — the same shape the picker's onAdd hands a host. */
export interface PendingPickExercise {
  wgerExerciseId: number
  source: ExerciseSource
  name: string
  category: string
}

export type PendingPick =
  /** Append to the session (the ADD_EXERCISE path). */
  | { mode: 'add'; exercise: PendingPickExercise }
  /** Swap the draft exercise whose stable client id is `targetId`. */
  | { mode: 'swap'; targetId: string; exercise: PendingPickExercise }

export const PENDING_PICK_KEY = 'workout:pending-pick'

/** Mirrors workout-input's MAX_NAME: a pick with a longer name could only
 *  wedge every later autosave against the server's payload cap. */
const MAX_NAME = 200

/** Validates AND rebuilds the picked exercise from exactly its four declared
 *  fields — a hostile writer's ride-along keys (a smuggled `id`, a `sets`
 *  blob…) must not survive the boundary and win a later object spread. */
function toPickExercise(value: unknown): PendingPickExercise | null {
  if (!value || typeof value !== 'object') return null
  const exercise = value as Record<string, unknown>
  const { wgerExerciseId, source, name, category } = exercise
  if (!(typeof wgerExerciseId === 'number' && Number.isInteger(wgerExerciseId) && wgerExerciseId > 0)) {
    return null
  }
  if (source !== 'wger' && source !== 'custom') return null
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_NAME) return null
  if (typeof category !== 'string') return null
  return { wgerExerciseId, source, name, category }
}

/** Validates a raw storage value into a `PendingPick`, or null when it can't
 *  be trusted (absent, malformed JSON, wrong shape). Pure — no storage I/O.
 *  The returned exercise is a FRESH object holding only the validated fields. */
export function parsePendingPick(raw: unknown): PendingPick | null {
  if (typeof raw !== 'string' || raw === '') return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const pick = value as Record<string, unknown>
  const exercise = toPickExercise(pick.exercise)
  if (!exercise) return null
  if (pick.mode === 'add') {
    return { mode: 'add', exercise }
  }
  if (pick.mode === 'swap' && typeof pick.targetId === 'string' && pick.targetId.length > 0) {
    return { mode: 'swap', targetId: pick.targetId, exercise }
  }
  return null
}

/** Best-effort write: a denied sessionStorage (some private modes) degrades
 *  the return to a plain back — the created exercise still exists and is one
 *  picker search away, so silence beats an error here. */
export function storePendingPick(pick: PendingPick): void {
  try {
    window.sessionStorage.setItem(PENDING_PICK_KEY, JSON.stringify(pick))
  } catch {
    // Storage denied — see the doc comment.
  }
}

/** Read-and-clear: the instruction fires at most once — a later logger mount
 *  (reload, fresh session) must never replay a stale swap. */
export function consumePendingPick(): PendingPick | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_PICK_KEY)
    if (raw !== null) window.sessionStorage.removeItem(PENDING_PICK_KEY)
    return parsePendingPick(raw)
  } catch {
    return null
  }
}
