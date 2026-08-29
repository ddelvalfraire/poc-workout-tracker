/**
 * GUARD 2, the pure half — how far a correction REACHES past the set it
 * touches.
 *
 * Correcting a number is normally local: a typo becomes the right number and
 * nothing else moves. Sometimes it is not, and the reach is invisible at the
 * edit surface — the set being fixed is the one holding a personal record, or
 * the one the plan read when it settled a training max. This module names
 * that reach so the disclosure at the edit surface can state it.
 *
 * Two rules shape the output, both from the artboard:
 *
 * - **Positive statements only.** The rejected shape was a two-column
 *   will/won't table: negations are hardest to parse exactly when the reader
 *   is anxious. What stays put is carried as a positive fact ("your training
 *   max stays at 102.5 kg"), separated by TREATMENT rather than by building a
 *   second column of "won't"s.
 * - **Silence is the default.** No record moves, nothing is shown. Put this
 *   on every edit and it becomes the thing people scroll past to reach the
 *   save button.
 *
 * No JSX and no database here, so this unit-tests as plain functions and the
 * client component can import its types without dragging Postgres into the
 * browser bundle — the split `workout-changelog-view.ts` already follows.
 */

/** The record slots a correction can move. Cardio slots are deliberately out
 *  of scope: this guard exists for the load record and the decisions taken
 *  off it, and widening it would dilute the silence it depends on. */
export type RecordReachKind = 'bestE1rm' | 'heaviestLoad' | 'mostReps' | 'bestSessionVolume'

/** One record the correction unseats, and the value it unseats. */
export interface RecordReachItem {
  kind: RecordReachKind
  /** The record as it stands TODAY — the thing the sentence is about. Kg for
   *  the load and volume slots, whole reps for `mostReps`. */
  value: number
  /** When it was set. Null when nothing held the slot before. */
  performedAt: Date | null
}

/**
 * A decision the app already TOOK off this history and is not revisiting.
 *
 * The whole reason the disclosure exists. Losing a personal record is obvious
 * and expected; a number quietly NOT moving is the one nobody predicts, and
 * the one that makes the app look wrong three weeks later.
 */
export interface SettledDecision {
  kind: 'trainingMax'
  valueKg: number
  /** When it was settled — the "it went up on 14 Aug" half. */
  decidedAt: Date
  /** Sessions trained at it since; the reason it is not being revisited. */
  sessionsSince: number
}

export interface CorrectionReach {
  /** What moves. Never empty — an empty reach is `null`, not a reach. */
  items: readonly RecordReachItem[]
  /** What stays, said positively. Null when no settled decision rides on this
   *  exercise at all. */
  settled: SettledDecision | null
}

/** The record-board fields this module reads. Structural rather than an
 *  import of `ExerciseRecords`, so the pure half stays free of the db module. */
export interface ReachRecords {
  bestE1rm: { workoutId: string; performedAt: Date; e1rm: number } | null
  heaviestLoadKg: { workoutId: string; performedAt: Date; weightKg: number } | null
  mostReps: { workoutId: string; performedAt: Date; reps: number } | null
  bestSessionVolumeKg: { workoutId: string; performedAt: Date; volumeKg: number } | null
}

/** One slot, reduced to the pair that decides whether it moved. */
interface SlotHolder {
  workoutId: string
  performedAt: Date
  value: number
}

interface Slot {
  kind: RecordReachKind
  holder: SlotHolder | null
}

function slots(records: ReachRecords): Slot[] {
  return [
    {
      kind: 'bestE1rm',
      holder: records.bestE1rm === null ? null : { ...records.bestE1rm, value: records.bestE1rm.e1rm },
    },
    {
      kind: 'heaviestLoad',
      holder:
        records.heaviestLoadKg === null
          ? null
          : { ...records.heaviestLoadKg, value: records.heaviestLoadKg.weightKg },
    },
    {
      kind: 'mostReps',
      holder:
        records.mostReps === null ? null : { ...records.mostReps, value: records.mostReps.reps },
    },
    {
      kind: 'bestSessionVolume',
      holder:
        records.bestSessionVolumeKg === null
          ? null
          : { ...records.bestSessionVolumeKg, value: records.bestSessionVolumeKg.volumeKg },
    },
  ]
}

/** Whether a slot's holder changed — a different session, or the same session
 *  at a different value. Both are the record moving; neither is a typo. */
function moved(before: SlotHolder | null, after: SlotHolder | null): boolean {
  if (before === null || after === null) return before !== after
  return before.workoutId !== after.workoutId || before.value !== after.value
}

/**
 * The reach of a correction: the record board as it stands, against the board
 * the correction would produce.
 *
 * Null when nothing moves — the ordinary typo fix, which gets no disclosure
 * at all. The settled decision rides along only when something DOES move: a
 * training max nothing is threatening needs no defending.
 *
 * The values quoted back come from `stored`, so they are the ones the reader
 * recognises. `edited` exists only to answer "does this slot move?" — naming
 * what a record WOULD become is a promise about a save that has not happened.
 */
export function correctionReach(
  stored: ReachRecords,
  edited: ReachRecords,
  settled: SettledDecision | null = null,
): CorrectionReach | null {
  const after = new Map(slots(edited).map((slot) => [slot.kind, slot.holder]))
  const items = slots(stored)
    .filter((slot) => moved(slot.holder, after.get(slot.kind) ?? null))
    .map(
      (slot): RecordReachItem => ({
        kind: slot.kind,
        value: slot.holder?.value ?? 0,
        performedAt: slot.holder?.performedAt ?? null,
      }),
    )
  if (items.length === 0) return null
  return { items, settled }
}
