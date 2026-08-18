/**
 * Show rule + label derivation for the logger's sticky identity-note chip
 * (Strong's pin pattern: contextual resurfacing, never a notes list). Pure —
 * the logger stays render-only over these and the parity test can pin the
 * gating without a DOM.
 */

/** The note payload the chip needs (mirror of LastPerformance['note']). */
export interface IdentityNote {
  body: string
  pinned: boolean
}

/**
 * Which note the chip shows for one exercise, if any.
 *
 * `override` is the session-local edit state (`undefined` = untouched this
 * session, `null` = deleted this session); `fromHistory` is the note that
 * rode the Prev query. Only PINNED notes resurface — an unpinned note exists
 * on the detail page but stays out of the logger (skip-by-ignoring: no note,
 * no markup, byte-identical fast path).
 */
export function stickyNote(
  override: IdentityNote | null | undefined,
  fromHistory: IdentityNote | null | undefined,
): IdentityNote | null {
  const note = override !== undefined ? override : (fromHistory ?? null)
  return note !== null && note.pinned ? note : null
}

/** Chip preview cap — one quiet line, never a paragraph. */
const CHIP_LABEL_MAX = 80

/**
 * First line of the note as plain words for the chip: markdown tokens
 * stripped (the chip is a control, not a document — tap opens the real
 * thing), links reduced to their label, hard-capped with an ellipsis.
 */
export function noteChipLabel(body: string): string {
  const firstLine = body.split('\n').find((line) => line.trim() !== '') ?? ''
  const plain = firstLine
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → label
    .replace(/^#{1,6}\s+/, '') // heading marker
    .replace(/^[-*]\s+/, '') // bullet marker
    .replace(/^\d+[.)]\s+/, '') // ordered marker
    .replace(/(\*\*|\*|`|__|_)/g, '') // inline marks
    .trim()
  return plain.length > CHIP_LABEL_MAX ? `${plain.slice(0, CHIP_LABEL_MAX - 1)}…` : plain
}

/**
 * Last-session echo (Hevy's one-session resurface) — the middle tier between
 * "session-only note" and "pinned forever". Shows the PREVIOUS session's
 * per-instance note exactly once, and only while it still adds anything:
 *
 * - `prevSessionNote` must be a real note (non-blank) — no history, no echo;
 * - `currentSessionNote` must still be empty — writing this session's note
 *   (including tap-to-copy) retires the echo;
 * - `shownPinned` (the note the pinned chip is ALREADY showing, i.e. the
 *   `stickyNote` result) must not carry the same text — one surface per fact.
 *   Both surfaces render through `noteChipLabel`, so "same text" is judged by
 *   the label the user actually sees: a pinned "**Seat pin 4**" and a prev
 *   "Seat pin 4" are the same words on screen even though the raw bodies
 *   differ. Raw equality implies label equality, so the label check subsumes
 *   the raw one — a suppressed echo is always a genuine display duplicate.
 *
 * Returns the trimmed echo text plus the ride-along `sessionSkipped` fact
 * (the previous instance was marked skipped — the logger labels the line
 * "Last time (skipped): …" so the echo never masquerades as a performance),
 * or null for "render nothing". The flag NEVER changes eligibility; it only
 * rides through so the render can speak it.
 */
export interface LastSessionEcho {
  text: string
  sessionSkipped: boolean
}

export function lastSessionEcho(
  prevSessionNote: string | null | undefined,
  currentSessionNote: string,
  shownPinned: IdentityNote | null,
  sessionSkipped = false,
): LastSessionEcho | null {
  const prev = prevSessionNote?.trim() ?? ''
  if (prev === '') return null
  if (currentSessionNote.trim() !== '') return null
  if (shownPinned !== null && noteChipLabel(shownPinned.body) === noteChipLabel(prev)) return null
  return { text: prev, sessionSkipped }
}
