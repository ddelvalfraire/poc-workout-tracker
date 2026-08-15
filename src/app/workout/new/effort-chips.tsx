'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  RIR_CHIPS,
  RPE_CHIPS,
  IDLE_COLLAPSE_MS,
  rpeHalfOf,
  nextRpeValue,
  rpeChipAriaLabel,
  rpeTargetChip,
  rirTargetChip,
  createIdleCollapse,
} from './effort-chip-logic'

/**
 * Post-completion effort chip row — the opt-in RPE/RIR capture surface.
 * RIR integer chips (0–5+) are the primary vocabulary; RPE whole-point
 * chips (6–10, half-points on the second tap) sit behind the small "RPE"
 * affordance for lifters who think in that scale.
 * Never blocks: no modal, no required answer — the row simply exists under
 * the just-completed set until the session moves on (skip-by-ignoring),
 * and an untouched row tidies itself after IDLE_COLLAPSE_MS.
 * Chips are CONTROLS here, so pill shapes are correct (de-card vocabulary);
 * muted throughout — logging effort is bookkeeping, never the volt moment.
 * The prescribed target's chip wears a hairline foreground ring (not volt);
 * selection stays bg-foreground.
 */

interface EffortChipsProps {
  /** Row identity for assistive tech, e.g. "set 2". */
  setLabel: string
  /** Current selections as draft strings ('' = none). */
  rir: string
  rpe: string
  /** The set's prescribed effort target as words ("RIR 2"), or null. */
  targetLabel: string | null
  /** The prescribed target as numbers — places the hairline target ring on
   *  the matching chip (a half-point RPE target rings its whole chip). */
  targetRir: number | null
  targetRpe: number | null
  /** A tap reports the new value; the SAME chip re-tapped reports '' (clear)
   *  for RIR, or cycles whole → half → '' for RPE. */
  onSelectRir: (value: string) => void
  onSelectRpe: (value: string) => void
  /** Fired when the row sat untouched for IDLE_COLLAPSE_MS — the owner
   *  collapses it to the quiet tappable slot (nothing blocks, log-late
   *  stays reachable). Any interaction inside the row resets the clock. */
  onIdleCollapse: () => void
}

export function EffortChips({
  setLabel,
  rir,
  rpe,
  targetLabel,
  targetRir,
  targetRpe,
  onSelectRir,
  onSelectRpe,
  onIdleCollapse,
}: EffortChipsProps) {
  // Advanced affordance: RPE chips replace the RIR row while open. Opens
  // pre-expanded when RPE is the scale already logged on this set.
  const [showRpe, setShowRpe] = useState(rpe !== '' && rir === '')

  // Idle collapse: armed on mount, re-armed by any interaction inside the
  // row (pointerdown on the root catches chips, scale switch, and misses),
  // cleared on unmount. The callback rides a ref so a re-render never
  // re-arms the window by itself.
  const onIdleCollapseRef = useRef(onIdleCollapse)
  useEffect(() => {
    onIdleCollapseRef.current = onIdleCollapse
  }, [onIdleCollapse])
  const idleRef = useRef<ReturnType<typeof createIdleCollapse> | null>(null)
  useEffect(() => {
    const idle = createIdleCollapse(() => onIdleCollapseRef.current(), IDLE_COLLAPSE_MS)
    idleRef.current = idle
    idle.arm()
    return () => {
      idle.clear()
      idleRef.current = null
    }
  }, [])

  const chips = showRpe ? RPE_CHIPS : RIR_CHIPS
  const targetChip = showRpe ? rpeTargetChip(targetRpe) : rirTargetChip(targetRir)

  return (
    <div
      className="pl-22 pr-11 motion-safe:animate-rise-in"
      onPointerDown={() => idleRef.current?.arm()}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
          {showRpe ? 'RPE' : 'RIR'}
        </span>
        <div
          role="group"
          aria-label={`${showRpe ? 'RPE' : 'Reps in reserve'} for ${setLabel}`}
          // py-1.5 keeps the chips' hit-44-y vertical extensions inside the
          // strip so they never overlap the set row above or the caption
          // below (nothing scrolls here anymore — both strips fit).
          className="flex min-w-0 flex-1 gap-1 py-1.5"
        >
          {chips.map((chip) => {
            const half = showRpe ? rpeHalfOf(chip) : null
            const isSelected = showRpe
              ? rpe === chip || (half !== null && rpe === half)
              : rir === chip
            const isTarget = chip === targetChip
            return (
              <button
                key={chip}
                type="button"
                onClick={() =>
                  showRpe
                    ? onSelectRpe(nextRpeValue(rpe, chip))
                    : onSelectRir(isSelected ? '' : chip)
                }
                aria-pressed={isSelected}
                aria-label={
                  showRpe
                    ? rpeChipAriaLabel(rpe, chip)
                    : `RIR ${chip}${chip === '5' ? ' or more' : ''}`
                }
                className={cn(
                  // Vertical-only inset: gap-1 neighbors sit closer than the
                  // full inset would reach, and adjacent invisible extensions
                  // must never overlap a chip meaning a different value.
                  'hit-44-y h-9 min-w-9 shrink-0 rounded-full px-2 text-sm font-medium tnum transition-colors',
                  // Muted selection state (one-volt rule: effort is a note,
                  // not the session's live moment).
                  isSelected
                    ? 'bg-foreground text-background'
                    : isTarget
                      ? // Target affordance: a hairline foreground ring —
                        // louder than ring-border, never volt.
                        'bg-transparent text-muted-foreground ring-1 ring-inset ring-foreground/40'
                      : 'bg-transparent text-muted-foreground ring-1 ring-inset ring-border',
                )}
              >
                {/* A selected half-point shows on its whole chip ("8.5"). */}
                {showRpe && half !== null && rpe === half
                  ? half
                  : !showRpe && chip === '5'
                    ? '5+'
                    : chip}
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
