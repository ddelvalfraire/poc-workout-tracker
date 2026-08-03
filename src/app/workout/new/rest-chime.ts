/**
 * Optional end-of-rest chirp — a device preference (localStorage, default
 * OFF) toggled in the rest sheet, played by the rest-over alert.
 *
 * Autoplay contract: the AudioContext is created/resumed ONLY inside user
 * gestures (`unlockRestChime`, called from set check-off and from enabling
 * the toggle) and `playRestChime` refuses to run unless the context is
 * already running — an autoplay-blocked error can never surface, the chirp
 * just stays silent until a gesture unlocks it.
 */

const CHIME_PREF_KEY = 'logger:rest-chime'

export function isRestChimeEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(CHIME_PREF_KEY) === '1'
  } catch {
    return false // storage blocked (private mode) — treat as default OFF
  }
}

export function setRestChimeEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (enabled) window.localStorage.setItem(CHIME_PREF_KEY, '1')
    else window.localStorage.removeItem(CHIME_PREF_KEY)
  } catch {
    // Storage blocked: the toggle simply won't persist — acceptable.
  }
}

let audioContext: AudioContext | null = null

/**
 * Call from a USER GESTURE only. No-ops when the chirp is disabled (no
 * point holding an audio session hostage for a feature that's off).
 */
export function unlockRestChime(): void {
  if (!isRestChimeEnabled()) return
  if (typeof window === 'undefined' || !('AudioContext' in window)) return
  try {
    audioContext ??= new AudioContext()
    if (audioContext.state === 'suspended') {
      void audioContext.resume().catch(() => {
        // Still locked — the next gesture retries.
      })
    }
  } catch {
    audioContext = null
  }
}

/** Two quick rising sine notes, ~350 ms total — a chirp, not an alarm. */
const CHIRP_NOTES: readonly { offsetSec: number; freqHz: number }[] = [
  { offsetSec: 0, freqHz: 880 },
  { offsetSec: 0.18, freqHz: 1175 },
]

export function playRestChime(): void {
  if (!isRestChimeEnabled()) return
  if (!audioContext || audioContext.state !== 'running') return
  try {
    const now = audioContext.currentTime
    for (const { offsetSec, freqHz } of CHIRP_NOTES) {
      const osc = audioContext.createOscillator()
      const gain = audioContext.createGain()
      osc.type = 'sine'
      osc.frequency.value = freqHz
      // Exponential attack/decay envelope: no clicks at the note edges.
      gain.gain.setValueAtTime(0.0001, now + offsetSec)
      gain.gain.exponentialRampToValueAtTime(0.2, now + offsetSec + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offsetSec + 0.15)
      osc.connect(gain).connect(audioContext.destination)
      osc.start(now + offsetSec)
      osc.stop(now + offsetSec + 0.16)
    }
  } catch {
    // Audio failure must never reach the session — silence is the fallback.
  }
}
