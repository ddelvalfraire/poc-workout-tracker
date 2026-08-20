/**
 * Pure view logic for the restart confirm step (block sequencing plan §5) —
 * JSX-free so it unit-tests as plain functions (same convention as
 * ./detail-view). The dialog body stays ONE string (ConfirmDialog's contract);
 * the TM notes append as extra sentences when the restart preview has any.
 */

import type { WeightUnit } from '@/lib/units'
import type { Message } from '@/lib/message'

/** One M4-flagged lift for the confirm step, already in display units. */
export interface RestartFlagPreview {
  exerciseName: string
  /** The suggested reduced TM (display unit), or null when none applies. */
  proposedTm: number | null
}

export interface RestartPreview {
  flagged: RestartFlagPreview[]
  /** How many clean amrap-cycle lifts step up one increment. */
  incrementCount: number
  unit: WeightUnit
}

export type RestartBodyKey =
  | 'dialog.body'
  | 'dialog.bodyIncrements'
  | 'dialog.bodyStalled'
  | 'dialog.bodyStalledReset'

/**
 * The confirm dialog's body as an ORDERED LIST of sentences, each its own
 * descriptor. A null preview (still loading, or the preview failed) reads
 * exactly as the dialog always has — the restart itself never waits on it.
 * Flagged lifts dedupe by name for display (the same lift on two days is one
 * sentence), reusing the M4 reset-proposal voice.
 *
 * A list rather than one string because ConfirmDialog takes a single `body`:
 * the caller renders each descriptor and joins them. Joining whole SENTENCES
 * is safe in a way that assembling one sentence from key fragments is not —
 * no word order crosses a boundary here.
 */
export function restartDialogBody(preview: RestartPreview | null): Message<RestartBodyKey>[] {
  const parts: Message<RestartBodyKey>[] = [{ key: 'dialog.body' }]
  if (preview === null) return parts
  if (preview.incrementCount > 0) {
    parts.push({ key: 'dialog.bodyIncrements', values: { lifts: preview.incrementCount } })
  }
  const seen = new Set<string>()
  for (const flag of preview.flagged) {
    if (seen.has(flag.exerciseName)) continue
    seen.add(flag.exerciseName)
    // The exercise name is catalog/user content, never translated — it rides
    // in as an argument so only the sentence around it is a message.
    parts.push(
      flag.proposedTm !== null
        ? {
            key: 'dialog.bodyStalledReset',
            values: { exercise: flag.exerciseName, tm: flag.proposedTm, unit: preview.unit },
          }
        : { key: 'dialog.bodyStalled', values: { exercise: flag.exerciseName } },
    )
  }
  return parts
}
