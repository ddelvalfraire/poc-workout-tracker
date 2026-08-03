/**
 * Feature-detected vibration for the logger's sensory layer. iOS Safari has
 * no navigator.vibrate — every call is a silent no-op there by design (no
 * fallback, no error): haptics are garnish, never load-bearing.
 */

/** A completed set: one short tick. */
export const SET_COMPLETE_VIBRATION = 10
/** The set that completes its exercise: a stronger double pulse. */
export const EXERCISE_COMPLETE_VIBRATION = [20, 60, 40]

export function vibrate(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return
  try {
    navigator.vibrate(pattern)
  } catch {
    // Some engines throw on vibrate without user activation — stay silent.
  }
}
