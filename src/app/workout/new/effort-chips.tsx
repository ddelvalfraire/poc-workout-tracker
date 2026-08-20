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
import { useTranslations } from 'next-intl'

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
  const t = useTranslations('EffortChips')
  // Advanced affordance: RPE chips replace the RIR row while open. Opens
  // pre-expanded when RPE is the scale already logged on this set.
  const [showRpe, setShowRpe] = useState(rpe !== '' && rir === '')

  // Idle collapse: armed on mount, re-armed by ANY interaction inside the
  // row — pointerdown catches taps (chips, scale switch, and misses), while
  // click + keydown catch keyboard users, whose Enter/Space arrives as a
  // bare click with no pointer sequence (a pointer tap firing both is a
  // harmless double-reset). Cleared on unmount. The callback rides a ref so
  // a re-render never re-arms the window by itself.
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
      className="pr-11 motion-safe:animate-rise-in"
      onPointerDown={() => idleRef.current?.arm()}
      onClick={() => idleRef.current?.arm()}
      onKeyDown={() => idleRef.current?.arm()}
    >
      {/* Scale label + switch ride their own line at input-column alignment;
          the chip strip below takes a shallower gutter so six chips fit the
          narrowest supported viewport without scroll or wrap. */}
      <div className="flex items-center justify-between pl-22">
        <span className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
          {showRpe ? t('scaleRpe') : t('scaleRir')}
        </span>
        <button
          type="button"
          onClick={() => setShowRpe((prev) => !prev)}
          aria-label={
            showRpe
              ? t('switchToRirAriaLabel', { set: setLabel })
              : t('switchToRpeAriaLabel', { set: setLabel })
          }
          className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground underline-offset-2 active:underline"
        >
          {showRpe ? t('scaleRir') : t('scaleRpe')}
        </button>
      </div>
      <div
        role="group"
        aria-label={
          showRpe
            ? t('groupAriaLabelRpe', { set: setLabel })
            : t('groupAriaLabelRir', { set: setLabel })
        }
        // py-1.5 keeps the chips' hit-44-y vertical extensions inside the
        // strip so they never overlap the line above or the caption below
        // (nothing scrolls here anymore — both strips fit).
        // Worst-case width math (320px viewport, RIR mode, 6 chips):
        // pl-11 (44) + 6 × min-w-8 (192) + 5 × gap-1 (20) + pr-11 (44,
        // wrapper) = 300px ≤ 320 — 20px slack. RPE mode is narrower
        // (5 chips = 264px), and a grown chip ("5+"/"8.5" over min-w at
        // px-1) adds ≤ 4px. Do not widen chips or gutters past this.
        className="flex min-w-0 gap-1 py-1.5 pl-11"
      >
        {chips.map((chip) => {
          const half = showRpe ? rpeHalfOf(chip) : null
          const isSelected = showRpe
            ? rpe === chip || (half !== null && rpe === half)
            : rir === chip
          const isTarget = chip === targetChip
          const rpeLabel = rpeChipAriaLabel(rpe, chip)
          return (
            <button
              key={chip}
              type="button"
              onClick={() =>
                showRpe ? onSelectRpe(nextRpeValue(rpe, chip)) : onSelectRir(isSelected ? '' : chip)
              }
              aria-pressed={isSelected}
              aria-label={
                showRpe
                  ? t(`rpeChipAriaLabel.${rpeLabel.key}`, rpeLabel.values)
                  : chip === '5'
                    ? t('rirChipAriaLabelMax', { chip })
                    : t('rirChipAriaLabel', { chip })
              }
              className={cn(
                // Vertical-only inset: gap-1 neighbors sit closer than the
                // full inset would reach, and adjacent invisible extensions
                // must never overlap a chip meaning a different value.
                // min-w-8 + px-1, not min-w-9 + px-2: the width budget is
                // what lets six chips fit 320px (math above); the a11y
                // target is carried by h-9 + hit-44-y (44px effective).
                'hit-44-y h-9 min-w-8 shrink-0 rounded-full px-1 text-sm font-medium tnum transition-colors',
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
                  ? t('rirChipMax')
                  : chip}
            </button>
          )
        })}
      </div>
      {/* The prescribed target restated as words — the loop the chips close.
          Quiet caption, same grammar as the plan target caption above. */}
      {targetLabel && (
        <p className="mt-0.5 pl-22 text-xs text-muted-foreground tnum">
          {t('targetCaption', { label: targetLabel })}
        </p>
      )}
    </div>
  )
}
