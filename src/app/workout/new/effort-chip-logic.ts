/**
 * Pure state logic for the effort chip row (#208) — the two-tap RPE cycle,
 * target-ring placement, and the idle-collapse timer. No React, no IO:
 * `effort-chips.tsx` renders these decisions; tests exercise them directly.
 */

/** RIR chips: 0–4 literal, 5 rendered "5+" (stored as 5 — beyond five reps
 *  in reserve the distinction carries no training signal). */
export const RIR_CHIPS = ['0', '1', '2', '3', '4', '5'] as const

/** RPE chips: whole points 6–10 — five chips fit without scrolling. The
 *  half-points live on the second tap of a selected chip (8 → 8.5), which
 *  kills the undiscoverable horizontal scroll the 9-chip strip needed.
 *  (Storage accepts 4+ for MCP/history; sub-6 taps have no training signal.) */
export const RPE_CHIPS = ['6', '7', '8', '9', '10'] as const

/** An untouched open chip row tidies itself after this idle window —
 *  skip-by-ignoring stays the zero-tap default; the collapsed slot stays
 *  tappable to log late. */
export const IDLE_COLLAPSE_MS = 5000

/** The half-point a whole chip's second tap reaches — null for 10 (the
 *  scale tops out; RPE 10.5 does not exist). */
export function rpeHalfOf(chip: string): string | null {
  return chip === '10' ? null : `${chip}.5`
}

/**
 * The two-tap cycle. Tapping a different chip always selects that whole;
 * tapping the selected whole cycles to its half point; tapping the half
 * clears. 10 has no half, so its cycle is whole → clear.
 */
export function nextRpeValue(current: string, chip: string): string {
  const half = rpeHalfOf(chip)
  if (current === chip) return half ?? ''
  if (half !== null && current === half) return ''
  return chip
}

/** Names the chip's NEXT action for assistive tech, not just its value —
 *  the two-tap cycle is invisible without it. */
export function rpeChipAriaLabel(current: string, chip: string): string {
  const half = rpeHalfOf(chip)
  if (current === chip) {
    return half !== null
      ? `RPE ${chip} — tap again for ${half}`
      : `RPE ${chip} — tap again to clear`
  }
  if (half !== null && current === half) return `RPE ${half} — tap again to clear`
  return `RPE ${chip}`
}

/** The RPE chip that carries the target hairline ring, or null. A half-point
 *  target (8.5) rings its whole-point chip (8) — the tap cycle reaches the
 *  half. Targets outside the 6–10 strip ring nothing. */
export function rpeTargetChip(target: number | null): string | null {
  if (target === null || !Number.isFinite(target)) return null
  const whole = Math.floor(target)
  if (whole < 6 || whole > 10) return null
  return String(whole)
}

/** The RIR chip that carries the target hairline ring, or null. Targets of
 *  five or more land on the "5+" chip (stored-as-5 semantics). */
export function rirTargetChip(target: number | null): string | null {
  if (target === null || !Number.isInteger(target) || target < 0) return null
  return String(Math.min(target, 5))
}

/** The idle-collapse timer as a tiny controller: `arm()` (re)starts the
 *  window — call it on mount and on every interaction inside the row —
 *  and `clear()` cancels it (unmount). */
export function createIdleCollapse(
  onCollapse: () => void,
  ms: number = IDLE_COLLAPSE_MS,
): { arm: () => void; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
  const arm = () => {
    clear()
    timer = setTimeout(() => {
      timer = null
      onCollapse()
    }, ms)
  }
  return { arm, clear }
}
