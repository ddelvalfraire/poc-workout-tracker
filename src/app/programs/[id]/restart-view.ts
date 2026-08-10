/**
 * Pure view logic for the restart confirm step (block sequencing plan §5) —
 * JSX-free so it unit-tests as plain functions (same convention as
 * ./detail-view). The dialog body stays ONE string (ConfirmDialog's contract);
 * the TM notes append as extra sentences when the restart preview has any.
 */

import type { WeightUnit } from '@/lib/units'

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

const BASE_BODY =
  'Creates a fresh copy of this program starting at week 1 and makes it active. ' +
  'This one is archived — its history and stats stay.'

/**
 * The confirm dialog's body: the base copy, plus the TM carry-forward notes
 * once the preview resolves. A null preview (still loading, or the preview
 * failed) reads exactly as the dialog always has — the restart itself never
 * waits on it. Flagged lifts dedupe by name for display (the same lift on two
 * days is one sentence), reusing the M4 reset-proposal voice.
 */
export function restartDialogBody(preview: RestartPreview | null): string {
  if (preview === null) return BASE_BODY
  const parts = [BASE_BODY]
  if (preview.incrementCount > 0) {
    parts.push(
      `Training maxes step up one increment for the new block (${preview.incrementCount} lift${preview.incrementCount === 1 ? '' : 's'}).`,
    )
  }
  const seen = new Set<string>()
  for (const flag of preview.flagged) {
    if (seen.has(flag.exerciseName)) continue
    seen.add(flag.exerciseName)
    parts.push(
      flag.proposedTm !== null
        ? `${flag.exerciseName} looks stalled — its training max stays put; consider a reset to ${flag.proposedTm} ${preview.unit} after restarting.`
        : `${flag.exerciseName} looks stalled — its training max stays put.`,
    )
  }
  return parts.join(' ')
}
