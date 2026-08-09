'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Post-completion effort chip row — the opt-in RPE/RIR capture surface.
 * RIR integer chips (0–5+) are the primary vocabulary; RPE half-points sit
 * behind the small "RPE" affordance for lifters who think in that scale.
 * Never blocks: no modal, no required answer — the row simply exists under
 * the just-completed set until the session moves on (skip-by-ignoring).
 * Chips are CONTROLS here, so pill shapes are correct (de-card vocabulary);
 * muted throughout — logging effort is bookkeeping, never the volt moment.
 */

/** RIR choices: 0–4 literal, 5 rendered "5+" (stored as 5 — beyond five reps
 *  in reserve the distinction carries no training signal). */
const RIR_CHOICES = ['0', '1', '2', '3', '4', '5'] as const

/** RPE half-point choices, 6–10 — the working range lifters actually report.
 *  (Storage accepts 4+ for MCP/history; sub-6 taps have no training signal.) */
const RPE_CHOICES = ['6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10'] as const

interface EffortChipsProps {
  /** Row identity for assistive tech, e.g. "set 2". */
  setLabel: string
  /** Current selections as draft strings ('' = none). */
  rir: string
  rpe: string
  /** The set's prescribed effort target as words ("RIR 2"), or null. */
  targetLabel: string | null
  /** A tap reports the new value; the SAME chip re-tapped reports '' (clear). */
  onSelectRir: (value: string) => void
  onSelectRpe: (value: string) => void
}

export function EffortChips({
  setLabel,
  rir,
  rpe,
  targetLabel,
  onSelectRir,
  onSelectRpe,
}: EffortChipsProps) {
  // Advanced affordance: RPE chips replace the RIR row while open. Opens
  // pre-expanded when RPE is the scale already logged on this set.
  const [showRpe, setShowRpe] = useState(rpe !== '' && rir === '')
  const choices = showRpe ? RPE_CHOICES : RIR_CHOICES
  const selected = showRpe ? rpe : rir
  const onSelect = showRpe ? onSelectRpe : onSelectRir

  return (
    <div className="pl-22 pr-11 motion-safe:animate-rise-in">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
          {showRpe ? 'RPE' : 'RIR'}
        </span>
        <div
          role="group"
          aria-label={`${showRpe ? 'RPE' : 'Reps in reserve'} for ${setLabel}`}
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-0.5"
        >
          {choices.map((choice) => {
            const isSelected = selected === choice
            return (
              <button
                key={choice}
                type="button"
                onClick={() => onSelect(isSelected ? '' : choice)}
                aria-pressed={isSelected}
                aria-label={`${showRpe ? 'RPE' : 'RIR'} ${choice}${!showRpe && choice === '5' ? ' or more' : ''}`}
                className={cn(
                  'h-8 min-w-8 shrink-0 rounded-full px-2 text-sm font-medium tnum transition-colors',
                  // Muted selection state (one-volt rule: effort is a note,
                  // not the session's live moment).
                  isSelected
                    ? 'bg-foreground text-background'
                    : 'bg-transparent text-muted-foreground ring-1 ring-inset ring-border',
                )}
              >
                {!showRpe && choice === '5' ? '5+' : choice}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={() => setShowRpe((prev) => !prev)}
          aria-label={showRpe ? `Switch to RIR for ${setLabel}` : `Switch to RPE for ${setLabel}`}
          className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground underline-offset-2 active:underline"
        >
          {showRpe ? 'RIR' : 'RPE'}
        </button>
      </div>
      {/* The prescribed target restated as words — the loop the chips close.
          Quiet caption, same grammar as the plan target caption above. */}
      {targetLabel && (
        <p className="mt-0.5 text-xs text-muted-foreground tnum">Target {targetLabel}</p>
      )}
    </div>
  )
}
