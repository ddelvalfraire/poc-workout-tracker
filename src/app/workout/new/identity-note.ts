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
