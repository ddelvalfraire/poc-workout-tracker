import { loadBar } from './plate-math'

/**
 * Label for the logger's per-side plate chip — the one-line answer to "what
 * do I rack" that rides under a focused weight input, computed against the
 * user's default bar (heaviest owned; the plate sheet stays the place to
 * pick another). Reuses loadBar so chip and sheet can never disagree.
 *
 * Returns null when there is nothing rackable to say: the field doesn't
 * parse to a positive weight, or the weight sits below the bar itself.
 * An inexact build is prefixed "≈" — the chip must never claim plates it
 * can't stack.
 */
export function plateChipLabel(
  weightText: string,
  bar: number,
  plates: readonly number[],
): string | null {
  const weight = Number(weightText.trim())
  if (!Number.isFinite(weight) || weight <= 0) return null
  const load = loadBar(weight, bar, [...plates])
  if (load === null) return null
  const label =
    load.perSide.length === 0
      ? 'bar only'
      : `${load.perSide.map((plate) => plate.toString()).join(' + ')} / side`
  return load.exact ? label : `≈ ${label}`
}
