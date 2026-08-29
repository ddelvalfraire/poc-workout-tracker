import { adoptableGhostValue } from '../format'

/**
 * The set row's persistent micro target caption — "▸ 8–12 × 100" under a row
 * whose typed value has hidden the plan ghost. Ghost and Prev semantics stay
 * untouched (input ghosts = plan targets, Prev chip = history — this caption
 * is a third, read-only surface that only restates the PLAN once typing
 * covers it).
 *
 * Visible only when BOTH hold:
 * - the row has a typed value (an empty row still shows the ghost itself);
 * - that typed value differs from the plan target it replaced. Matching the
 *   target verbatim — or a range's adoptable floor, what tap-to-accept
 *   fills — means the plan is already on screen; repeating it is noise.
 *
 * Returns the caption text (plan reps, then "× weight" when the plan
 * prescribes one), or null when the caption must not render.
 */
export function targetCaption(
  typed: { reps: string; weight: string },
  plan: { reps?: string; weight?: string },
): string | null {
  if (!plan.reps && !plan.weight) return null

  const repsTyped = typed.reps.trim()
  const weightTyped = typed.weight.trim()

  const repsDiffer =
    repsTyped !== '' &&
    plan.reps !== undefined &&
    repsTyped !== plan.reps &&
    repsTyped !== adoptableGhostValue(plan.reps)
  const weightDiffer =
    weightTyped !== '' &&
    plan.weight !== undefined &&
    !numericallyEqual(weightTyped, plan.weight)

  if (!repsDiffer && !weightDiffer) return null

  const parts = [plan.reps, plan.weight ? `× ${plan.weight}` : undefined].filter(
    (part): part is string => part !== undefined,
  )
  return `▸ ${parts.join(' ')}`
}

/** "100" vs "100.0" is the same weight; non-numeric text never matches. */
function numericallyEqual(a: string, b: string): boolean {
  const aNum = Number(a)
  const bNum = Number(b)
  if (!Number.isFinite(aNum) || !Number.isFinite(bNum)) return a === b
  return aNum === bNum
}
