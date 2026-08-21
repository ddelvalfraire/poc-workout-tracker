'use client'

import { useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { adoptableGhostValue, stepWeightValue, WEIGHT_STEP } from '@/lib/format'
import { plateChipLabel } from '@/lib/plate-chip'
import type { WeightUnit } from '@/lib/units'
import type { LoggingType } from '@/lib/workout-input'
import { cn } from '@/lib/utils'
import { vibrate } from './haptics'
import { useTranslations } from 'next-intl'

/**
 * The weight-input accessory rail: a hairline ButtonGroup ± pair (signed
 * step chips, never bare icons) plus the per-side plate chip, shown while a
 * weight input holds focus (the logger owns that gating via stepperSetId).
 * Extracted from workout-logger.tsx (#216); precedent: rest-pill.tsx.
 *
 * It DOCKS IN THE STICKY BAR — that is a correctness contract, not a
 * placement preference, so do not move it back under the focused row.
 * Focus-gated content inside the scrolling flow changes the height of
 * everything below it at the exact moment a tap begins: mousedown blurs the
 * input, the rail unmounts, the control under the finger jumps, mouseup
 * lands elsewhere, and the browser never synthesizes a click at all. The bar
 * is bottom-anchored, so the rail grows it upward and nothing moves. See the
 * mount site in workout-logger.tsx; pinned by e2e/sticky-cta.spec.ts.
 *
 * Load-bearing contracts, do not touch:
 * - `onPointerDown` preventDefault on every control keeps the weight input
 *   focused so the row (and the iOS keyboard) don't dismiss mid-tap.
 * - Step math is `stepWeightValue` + `WEIGHT_STEP[unit]` (ghost-seeded, no
 *   float drift, floors at 0) — accelerated holds CHAIN it rather than
 *   multiplying, so clamping semantics can never diverge.
 * - Segments use hit-44-y (vertical-only insets — see button-group.tsx for
 *   why full insets would mis-arbitrate across the divider).
 *
 * Hold-to-autorepeat (the UIStepper convention): pointerdown steps once and
 * arms a timer chain — first repeat after HOLD_DELAY_MS, then every
 * HOLD_INTERVAL_MS, and after HOLD_ACCEL_AFTER repeats each step multiplies
 * by HOLD_ACCEL_FACTOR. pointerup/pointercancel/pointerleave clears the
 * chain, so a tap (release before the first repeat) is exactly one step.
 * preventDefault blocks focus loss but NOT pointer delivery, so the chain
 * keeps firing while the finger stays down.
 *
 * Feedback per applied step: a 150ms opacity dip on the weight value (Web
 * Animations — an input can't re-key a CSS animation without remounting and
 * dropping focus) and vibrate(10) via the haptics module. Both, plus the
 * press scale, are motion-safe/garnish: reduced motion gets instant swaps.
 * At the 0 floor the − half drops to 40% opacity (aria-disabled, full hit
 * area kept) instead of a pointer-events-killing `disabled`.
 */

/** Hold-to-autorepeat schedule (UIStepper convention). */
export const HOLD_DELAY_MS = 400
export const HOLD_INTERVAL_MS = 150
/** Repeats at 1× before acceleration kicks in. */
export const HOLD_ACCEL_AFTER = 8
export const HOLD_ACCEL_FACTOR = 5
/** Per-step feedback: value-dip duration and haptic tick. */
const STEP_DIP_MS = 150
const STEP_VIBRATION = 10
/** How long after a pointer gesture its synthesized click may still arrive
 *  and be swallowed. Longer than any tap; far shorter than the gap before a
 *  genuine keyboard/AT activation that must step. */
const CLICK_SWALLOW_WINDOW_MS = 700

/** Delay before the Nth repeat (0-based): the first waits the long press-in
 *  delay, every later one the fast interval. */
export function holdRepeatDelay(repeatIndex: number): number {
  return repeatIndex === 0 ? HOLD_DELAY_MS : HOLD_INTERVAL_MS
}

/** Step multiplier for the Nth repeat (0-based): 1× until HOLD_ACCEL_AFTER
 *  repeats have fired, then HOLD_ACCEL_FACTOR×. */
export function holdStepMultiplier(repeatIndex: number): number {
  return repeatIndex >= HOLD_ACCEL_AFTER ? HOLD_ACCEL_FACTOR : 1
}

export interface HoldRepeater {
  start: () => void
  stop: () => void
}

/**
 * The repeat engine, framework-free so the schedule unit-tests with fake
 * timers: start() arms the chain (restarting if already armed), stop()
 * cancels whatever is pending. `fire` receives the step multiplier for
 * that repeat.
 */
export function createHoldRepeater(fire: (multiplier: number) => void): HoldRepeater {
  let timer: ReturnType<typeof setTimeout> | null = null
  const stop = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
  const start = () => {
    stop()
    let repeatIndex = 0
    const schedule = () => {
      timer = setTimeout(() => {
        fire(holdStepMultiplier(repeatIndex))
        repeatIndex += 1
        schedule()
      }, holdRepeatDelay(repeatIndex))
    }
    schedule()
  }
  return { start, stop }
}

/**
 * `stepWeightValue` applied `times` over — the accelerated-hold step. A
 * chain (not one big jump) so the 0 floor and ghost seeding behave exactly
 * like `times` single taps; null passes through unchanged (non-numeric text
 * still no-ops rather than being clobbered).
 */
export function stepWeightValueBy(
  current: string,
  ghost: string | undefined,
  direction: 1 | -1,
  unit: WeightUnit,
  times: number,
): string | null {
  let value = current
  for (let i = 0; i < times; i++) {
    const next = stepWeightValue(value, ghost, direction, unit)
    if (next === null) return null
    value = next
  }
  return value
}

/** 150ms opacity dip on the stepped value — skipped entirely under reduced
 *  motion (instant swap only). */
function dipWeightValue(inputId: string): void {
  if (typeof document === 'undefined') return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  document
    .getElementById(inputId)
    ?.animate?.([{ opacity: 0.4 }, { opacity: 1 }], { duration: STEP_DIP_MS, easing: 'ease-out' })
}

interface WeightStepperProps {
  /** 0-based set position, for the controls' aria labels. */
  setIndex: number
  /** The weight `<input>`'s DOM id — the value-dip target. */
  inputId: string
  /** The set's current typed weight (may be empty — ghost seeds the step). */
  weight: string
  /** The row's ghost placeholder; undefined for BW-relative types by design
   *  (their steppers step the typed value or from zero). */
  ghostWeight: string | undefined
  unit: WeightUnit
  loggingType: LoggingType
  /** Default (heaviest) bar + owned plates for the per-side chip. */
  bar: number
  plates: readonly number[]
  onWeightChange: (value: string) => void
  onOpenPlateSheet: () => void
}

export function WeightStepper({
  setIndex,
  inputId,
  weight,
  ghostWeight,
  unit,
  loggingType,
  bar,
  plates,
  onWeightChange,
  onOpenPlateSheet,
}: WeightStepperProps) {
  const t = useTranslations('WeightStepper')
  // The hold chain outlives renders: repeats read the freshest value/handler
  // through refs so a 150ms tick never steps from a stale prop.
  const weightRef = useRef(weight)
  const onWeightChangeRef = useRef(onWeightChange)
  useEffect(() => {
    weightRef.current = weight
  }, [weight])
  useEffect(() => {
    onWeightChangeRef.current = onWeightChange
  }, [onWeightChange])

  const applyStep = useCallback(
    (direction: 1 | -1, multiplier: number) => {
      const next = stepWeightValueBy(weightRef.current, ghostWeight, direction, unit, multiplier)
      // No-op steps (non-numeric text, or holding − at the 0 floor) get no
      // feedback — a vibration for nothing would read as a phantom change.
      if (next === null || next === weightRef.current) return
      // Keep the ref hot immediately: the next repeat may fire before the
      // parent's state round-trips back down as a prop.
      weightRef.current = next
      onWeightChangeRef.current(next)
      vibrate(STEP_VIBRATION)
      dipWeightValue(inputId)
    },
    [ghostWeight, unit, inputId],
  )

  const holdRef = useRef<HoldRepeater | null>(null)
  const stopHold = useCallback(() => holdRef.current?.stop(), [])
  // Blur unmounts the rail mid-hold — the pending timer must die with it.
  useEffect(() => stopHold, [stopHold])
  const startHold = useCallback(
    (direction: 1 | -1) => {
      holdRef.current?.stop()
      holdRef.current = createHoldRepeater((multiplier) => applyStep(direction, multiplier))
      holdRef.current.start()
    },
    [applyStep],
  )
  // pointerdown already stepped, so the click that follows pointerup must be
  // swallowed — but ONLY then: keyboard activation arrives as a bare click
  // and must still step. The guard is a TIMESTAMP, not a flag: a click is
  // swallowed only within CLICK_SWALLOW_WINDOW_MS of the pointer gesture's
  // latest event (down/up/leave all refresh it), so a stale guard from a
  // gesture whose click never came can't eat a keyboard step minutes later.
  // With implicit pointer capture on touch, a hold that wobbles off the hit
  // box fires pointerleave yet the synthesized click still lands on this
  // button — the leave refreshes (never clears) the stamp so that click is
  // still swallowed. pointercancel clears it: a canceled pointer synthesizes
  // no click, so whatever click comes next is a fresh gesture that must step.
  const pointerSteppedAtRef = useRef<number | null>(null)
  // Which segment owns the live hold chain. While a chain is active, a
  // second finger landing on the other segment is IGNORED (no step, no chain
  // replacement) — and only the owning segment's up/leave/cancel may stop
  // the chain, so a stray second finger can't kill a hold mid-flight.
  const activeHoldRef = useRef<1 | -1 | null>(null)
  const endHold = useCallback(
    (direction: 1 | -1) => {
      if (activeHoldRef.current !== direction) return
      activeHoldRef.current = null
      stopHold()
    },
    [stopHold],
  )

  // The − half is "disabled" at the effective 0 floor: same base extraction
  // as stepWeightValue so the two can never disagree about where 0 is.
  const base = weight.trim() !== '' ? weight.trim() : (adoptableGhostValue(ghostWeight) ?? '0')
  const atFloor = /^\d+(\.\d+)?$/.test(base) && Number(base) === 0

  const weightNoun =
    loggingType === 'weighted_bodyweight'
      ? t('noun.addedWeight')
      : loggingType === 'assisted_bodyweight'
        ? t('noun.assistance')
        : t('noun.weight')

  return (
    // Full-width rail — one control, not two orphaned buttons floating
    // right. Hairline ButtonGroup skin only, no card shell. No column
    // insets: docked in the bar it spans the bar's width, where the old
    // pl-22/pr-11 (calibrated to a set row's circle + prev + X columns)
    // would read as an arbitrary indent.
    <div className="flex flex-col gap-1.5 motion-safe:animate-rise-in">
      <ButtonGroup>
        {([-1, 1] as const).map((direction) => {
          const isFloored = direction === -1 && atFloor
          return (
            <Button
              key={direction}
              size="sm"
              variant="ghost"
              // Not `disabled`: that kills pointer events and would shrink
              // the hit area exactly where a fat-thumbed miss is likeliest.
              aria-disabled={isFloored || undefined}
              className={cn(
                'hit-44-y min-w-16 font-semibold tnum',
                'motion-safe:active:scale-[0.97]',
                isFloored && 'opacity-40',
              )}
              onPointerDown={(e) => {
                // Keeps the weight input focused (and the iOS keyboard up) —
                // pointer delivery continues, so the hold chain still runs.
                e.preventDefault()
                // Arm the swallow guard even when this pointerdown won't step
                // (floored, or a second finger): its synthesized click must
                // never step either.
                pointerSteppedAtRef.current = Date.now()
                // A chain is already live: a second finger on either segment
                // neither steps nor replaces the chain.
                if (activeHoldRef.current !== null) return
                if (isFloored) return
                activeHoldRef.current = direction
                applyStep(direction, 1)
                startHold(direction)
              }}
              onPointerUp={() => {
                if (pointerSteppedAtRef.current !== null) pointerSteppedAtRef.current = Date.now()
                endHold(direction)
              }}
              onPointerCancel={() => {
                // No click follows a canceled pointer — the next click is a
                // fresh gesture (keyboard/AT) and must step.
                pointerSteppedAtRef.current = null
                endHold(direction)
              }}
              onPointerLeave={() => {
                if (pointerSteppedAtRef.current !== null) pointerSteppedAtRef.current = Date.now()
                endHold(direction)
              }}
              onClick={() => {
                const armedAt = pointerSteppedAtRef.current
                pointerSteppedAtRef.current = null
                if (armedAt !== null && Date.now() - armedAt <= CLICK_SWALLOW_WINDOW_MS) return
                if (isFloored) return
                applyStep(direction, 1)
              }}
              aria-label={
                direction === 1
                  ? t('increaseAriaLabel', {
                      set: setIndex + 1,
                      noun: weightNoun,
                      step: WEIGHT_STEP[unit],
                      unit,
                    })
                  : t('decreaseAriaLabel', {
                      set: setIndex + 1,
                      noun: weightNoun,
                      step: WEIGHT_STEP[unit],
                      unit,
                    })
              }
            >
              {direction === 1
                ? t('stepIncrease', { step: WEIGHT_STEP[unit] })
                : t('stepDecrease', { step: WEIGHT_STEP[unit] })}
            </Button>
          )
        })}
      </ButtonGroup>
      {/* Per-side plate chip: the racked answer for the focused weight,
          against the default (heaviest) bar — barbell totals only, and only
          when the field parses to a rackable number. Tap opens the full
          plate sheet. pointerdown preventDefault keeps the input focused
          (same trick as the steppers) so the strip doesn't unmount before
          the click lands. */}
      {loggingType === 'weight_reps' &&
        (() => {
          const chip = plateChipLabel(weight, bar, plates)
          if (!chip) return null
          return (
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={onOpenPlateSheet}
              aria-label={t('plateChipAriaLabel', { chip })}
              className="self-start text-xs text-muted-foreground tnum underline-offset-2 active:underline"
            >
              {chip}
            </button>
          )
        })()}
    </div>
  )
}
