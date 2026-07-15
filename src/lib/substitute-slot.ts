import type { Progression } from './program-input'
import type { ProgramSetRowLike, SetOverrideLike } from './progression'

/**
 * Sanitizes a program-exercise slot for MID-SESSION substitution — the piece
 * that lets a swapped exercise inherit the plan's STRUCTURE without ever
 * inheriting the original movement's loads.
 */

/** The slot slice the substitution re-derives — matches DayForDerivation's
 *  exercise element (db/programs.ts). */
export interface SlotForSubstitution {
  wgerExerciseId: number
  progression: Progression | null
  sets: (ProgramSetRowLike & { overrides: (SetOverrideLike & { week: number })[] })[]
}

/** Schemes whose loads come from an ORIGINAL-movement training max — kept,
 *  they'd prescribe squat loads to a leg press. Base-anchored schemes are
 *  fine once the base is stripped (loads go null); rpe-target anchors on the
 *  substitute's own history e1RM and transfers perfectly. */
const TM_BASED_SCHEMES = new Set<Progression['scheme']>(['percent-1rm', 'amrap-cycle'])

/**
 * The original slot re-pointed at the substitute, with every absolute load
 * that belongs to the ORIGINAL movement stripped: template suggestedLoadKg,
 * override suggestedLoadKg, and TM-based progressions. Set scheme, rep
 * ranges, RIR/RPE, rest, technique, and rep/rest overrides all survive — the
 * plan's structure transfers; its loads don't (same meaning-change rule as
 * the swap's value reset). Feed the result to deriveDayPrescription as a
 * one-exercise day: the engine's history reads then target the substitute.
 */
export function substituteSlot(
  slot: SlotForSubstitution,
  substituteId: number,
): SlotForSubstitution {
  return {
    wgerExerciseId: substituteId,
    progression:
      slot.progression && TM_BASED_SCHEMES.has(slot.progression.scheme) ? null : slot.progression,
    sets: slot.sets.map((set) => ({
      ...set,
      suggestedLoadKg: null,
      overrides: set.overrides.map((o) => ({ ...o, suggestedLoadKg: null })),
    })),
  }
}
