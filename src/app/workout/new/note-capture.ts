import type { WeightUnit } from '@/lib/units'
import type { DraftExercise, DraftSet, WorkoutDraft } from './workout-draft'
import type { PendingNote } from './pending-notes'

/**
 * Pure logic for the notes-v2 capture sheet and the logger's note grammar
 * (kept free of React/IO so it unit-tests as plain functions — the
 * workout-draft.ts idiom): scope addressing, breadcrumbs, the anchored set's
 * snapshot subtitle, tag-token insertion, indicator roll-ups, and the
 * save-time collection of set notes into positional entries.
 *
 * WHY set notes are positional until save (the anchor-resolution design):
 * draft set ids are CLIENT ids — seeded sets reuse server uuids, but any set
 * added mid-session has no server row, and updateWorkout's full replace
 * re-mints every set id at Finish anyway. Resolving an anchor mid-session
 * would therefore either fail (new sets, new sessions) or go stale (the
 * replace). So set notes ride the DRAFT (`DraftSet.note`, offline-safe via
 * draft-sync, cross-device via the payload) and are created as real `notes`
 * rows exactly once, AFTER the save, against the just-inserted rows — by
 * (exercisePosition, setNumber), the same addressing insertWorkoutChildren
 * writes. `noteClientKey` (minted once per note) is the idempotency handle:
 * a replayed finish or a queue re-send dedupes on (user_id, client_key).
 */

/** Where a captured note lands. Set is the most specific (the default when
 *  the sheet opens from a set row); exercise/workout scopes route into the
 *  existing draft note tiers (the #211 grammar this sheet absorbs). */
export type NoteScope = 'set' | 'exercise' | 'workout'

/** The accessory-bar tag tokens, inserted inline (the body carries its
 *  metadata — no tag columns). */
export const NOTE_TAG_TOKENS = ['#pain', '#form', '#pr', '#equipment'] as const

/**
 * Inserts a tag token at the caret (replacing any selection), padding with a
 * space on the left only where one is missing — "left shoulder|" + "#form" →
 * "left shoulder #form " with the caret after the trailing space.
 */
export function insertToken(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  token: string,
): { text: string; caret: number } {
  const start = Math.max(0, Math.min(selectionStart, text.length))
  const end = Math.max(start, Math.min(selectionEnd, text.length))
  const before = text.slice(0, start)
  const after = text.slice(end)
  const needsLeadingSpace = before !== '' && !/\s$/.test(before)
  // No trailing space when one already follows — "#form  here" reads sloppy.
  const needsTrailingSpace = !/^\s/.test(after)
  const inserted = `${needsLeadingSpace ? ' ' : ''}${token}${needsTrailingSpace ? ' ' : ''}`
  return {
    text: `${before}${inserted}${after}`,
    caret: start + inserted.length,
  }
}

/** The sheet's anchor breadcrumb: "Bench Press · Set 3" / "Bench Press" /
 *  "Workout" — which entity the pending note will hang on. */
export function noteBreadcrumb(
  scope: NoteScope,
  exerciseName: string,
  setNumber: number,
): string {
  switch (scope) {
    case 'set':
      return `${exerciseName} · Set ${setNumber}`
    case 'exercise':
      return exerciseName
    case 'workout':
      return 'Workout'
  }
}

/**
 * The anchored set's snapshot subtitle, from the DRAFT row (typed values,
 * display unit — quantized by being exactly what the inputs show): "185 lb ×
 * 6 · RPE 9". Cardio rows read their duration; a row with nothing typed yet
 * returns null (no subtitle beats a row of dashes).
 */
export function setSnapshotLabel(
  set: Pick<DraftSet, 'reps' | 'weight' | 'rir' | 'rpe' | 'metricMode' | 'duration' | 'distance'>,
  loggingType: DraftExercise['loggingType'],
  unit: WeightUnit,
): string | null {
  const parts: string[] = []
  if ((set.metricMode ?? 'reps_weight') !== 'reps_weight') {
    const duration = (set.duration ?? '').trim()
    const distance = (set.distance ?? '').trim()
    if (duration !== '') parts.push(duration)
    if (distance !== '') parts.push(`${distance} km`)
  } else {
    const reps = set.reps.trim()
    const weight = set.weight.trim()
    const load =
      loggingType === 'bodyweight_reps'
        ? 'BW'
        : weight !== ''
          ? `${weight} ${unit}`
          : null
    if (load !== null && reps !== '') parts.push(`${load} × ${reps}`)
    else if (load !== null) parts.push(load)
    else if (reps !== '') parts.push(`× ${reps}`)
  }
  const rpe = (set.rpe ?? '').trim()
  const rir = (set.rir ?? '').trim()
  if (rpe !== '') parts.push(`RPE ${rpe}`)
  else if (rir !== '') parts.push(`RIR ${rir}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** True when this draft set carries a note (the volt-dot predicate). */
export function setHasNote(set: Pick<DraftSet, 'note'>): boolean {
  return (set.note ?? '').trim() !== ''
}

/** The exercise header's rolled-up count: its own instance note (0/1) plus
 *  every noted set. 0 = render nothing (the byte-identical fast path). */
export function exerciseNoteCount(
  exercise: Pick<DraftExercise, 'notes'> & { sets: Pick<DraftSet, 'note'>[] },
): number {
  const own = exercise.notes.trim() !== '' ? 1 : 0
  return own + exercise.sets.filter(setHasNote).length
}

/** One set note ready for post-save creation, addressed the way
 *  insertWorkoutChildren writes rows: 0-based exercise position, 1-based set
 *  number. `exerciseName` rides along for error context only. */
export interface PositionalSetNote {
  exercisePosition: number
  setNumber: number
  body: string
  clientKey: string
  exerciseName: string
}

/**
 * Collects every noted set in the draft into positional entries for the
 * post-save create. Notes without a clientKey are skipped defensively (the
 * logger mints the key at capture; a hand-built draft without one has no
 * idempotency handle and must not send). Skipped exercises still collect —
 * a note is a fact about the session either way.
 */
export function collectSetNotes(draft: WorkoutDraft): PositionalSetNote[] {
  const entries: PositionalSetNote[] = []
  draft.exercises.forEach((exercise, exercisePosition) => {
    exercise.sets.forEach((set, setIndex) => {
      const body = (set.note ?? '').trim()
      if (body === '' || set.noteClientKey === undefined) return
      entries.push({
        exercisePosition,
        setNumber: setIndex + 1,
        body,
        clientKey: set.noteClientKey,
        exerciseName: exercise.name,
      })
    })
  })
  return entries
}

/**
 * Downgrades positional entries into pending-notes queue items when the
 * post-save batch create fails (offline the instant after a save, or a
 * transient 500): each note re-anchors to the WORKOUT (a uuid the queue can
 * carry — set ids were never known client-side) so the words survive with
 * less precision instead of vanishing. The queue's send routes these through
 * the fallback action, which stamps a marker snapshot so the note can never
 * masquerade as the canonical session note (note-sync's fallback rule).
 * `PendingNote.id` = the note's clientKey, so entries that DID land before
 * the failure dedupe server-side on re-send.
 */
export function fallbackPendingNotes(
  workoutId: string,
  entries: PositionalSetNote[],
  now: Date,
): PendingNote[] {
  return entries.map((entry) => ({
    id: entry.clientKey,
    anchor: { kind: 'workout', id: workoutId },
    body: entry.body,
    createdAt: now.toISOString(),
  }))
}

/** The IO seams persistSetNotes orchestrates — the logger injects the batch
 *  server action and the pending-notes queue's enqueue. */
export interface PersistSetNotesDeps {
  /** The one post-save round trip (createSetNotesForWorkoutAction). */
  createBatch: (workoutId: string, entries: PositionalSetNote[]) => Promise<void>
  /** The downgrade path: one pending-notes queue item per entry. */
  enqueue: (note: PendingNote) => void
  /** Injectable clock for deterministic tests; defaults to wall time. */
  now?: () => Date
}

/**
 * The post-save orchestration for capture-sheet set notes (extracted from the
 * logger so the riskiest mechanism unit-tests as a plain function): collect
 * the draft's noted sets, send them as ONE batch against the just-saved
 * workout, and on ANY failure downgrade every entry into the pending-notes
 * queue as a workout-anchored fallback — clientKeys intact, so entries that
 * landed before the failure dedupe server-side on replay, and a retry never
 * re-mints keys. Never throws: the save already succeeded and the finish
 * navigation must not be held hostage by a notes hiccup.
 */
export async function persistSetNotes(
  workoutId: string,
  draft: WorkoutDraft,
  deps: PersistSetNotesDeps,
): Promise<void> {
  const entries = collectSetNotes(draft)
  if (entries.length === 0) return
  try {
    await deps.createBatch(workoutId, entries)
  } catch {
    const now = deps.now?.() ?? new Date()
    for (const note of fallbackPendingNotes(workoutId, entries, now)) {
      deps.enqueue(note)
    }
  }
}
