/**
 * The take-it-back contract for granular program edits.
 *
 * ## Why this module exists
 *
 * The program editor emits granular ops (add/update/remove/move) with no
 * explicit Save, so there is no "abandon the draft" escape: every change is
 * already committed. Undo is the escape. The two obvious foundations both fail:
 *
 * 1. **`program_events` cannot invert.** The change log is a NARRATIVE — it
 *    records `after` for most ops and only the addressing coordinates for the
 *    destructive ones (`remove_program_set` stores `{ setNumber }` and nothing
 *    else; the set's targets are gone the moment the DELETE commits). Only
 *    `update_program_set` and `adjust_training_max` carry a before-image. The
 *    log's own doc comment forbids whole-program snapshots, and turning it into
 *    a backup would change what that table IS. So the log stays a narrative and
 *    undo carries its own before-image.
 * 2. **Positions cannot address an inverse.** Every patch op addresses by
 *    `dayPosition` / `exercisePosition` / `setNumber`, and every op renumbers
 *    its siblings. "Undo move day 3 → 1" is NOT "move day 1 → 3": if anything
 *    else moved in between, replaying the numeric mirror silently reorders the
 *    wrong rows. Positions describe a moment; they cannot survive one.
 *
 * ## The shape
 *
 * An op that can be taken back returns an {@link UndoTicket} computed by the
 * SERVER inside the mutation's own transaction — the only moment the
 * before-image is guaranteed both correct and free to read. The client holds
 * the ticket in memory for the length of one toast and throws it away on
 * navigation. Nothing is persisted: undo is a few seconds of grace, not a
 * revision history.
 *
 * Two independent defences make applying one safe:
 *
 * - **Anchored by id.** An inverse never names a position. It names the stable
 *   row uuid it acts on and, for order restoration, the uuid of the sibling it
 *   used to follow ({@link InverseOp}'s `after`, `null` meaning first). An
 *   anchor either still resolves — and then restores the real prior order — or
 *   it has vanished, and the op refuses instead of guessing.
 * - **Compare-and-swap on the program.** Every patch op bumps
 *   `programs.updated_at`; a ticket records the value its own op left behind.
 *   Undo applies only while that value is untouched, so ANY interleaving
 *   write — the coach agent, a second tab, another device — invalidates every
 *   outstanding ticket. Over a seconds-long window a false refusal is rare and
 *   always safe, which is the trade this feature wants. See
 *   {@link isTicketFresh}.
 *
 * The id anchors are belt to the CAS's braces: CAS alone would let a numeric
 * inverse work, but anchors make a mis-applied inverse impossible to express
 * rather than merely unlikely to occur.
 *
 * ## One ticket per gesture — what the CAS means for a batch
 *
 * A consequence of comparing the WHOLE program's `updated_at`: in a multi-op
 * batch — a multi-patch coach proposal, or one UI gesture firing several
 * moves — op 2's bump invalidates op 1's ticket the instant it lands, so only
 * the last op of a batch could ever mint a usable ticket. That is the intended
 * semantics, not an accident: **undo takes back the last thing, never a
 * fragment of a compound edit.**
 *
 * It obliges callers, so it is stated as a rule rather than left emergent:
 *
 * - A caller running several ops as one gesture mints AT MOST ONE ticket, after
 *   the final bump, describing the gesture as a whole. Minting per-op and
 *   keeping the last is that same rule done wastefully; keeping the FIRST is a
 *   bug that hands back a ticket guaranteed to refuse as `stale`.
 * - A gesture whose reversal is not expressible as one {@link InverseOp} mints
 *   NOTHING and takes the guard its most expensive op takes. Half an undo is
 *   worse than none.
 * - Batch proposal application is out of scope entirely: `confirm_patch_proposal`
 *   is not in {@link EDIT_GUARDS}, so it falls to `confirm` and never mints.
 *
 * ## Security note for the apply path
 *
 * A ticket travels through the client, so every uuid inside it is
 * ATTACKER-CONTROLLED INPUT. The db layer applying an inverse must re-resolve
 * every id through the ownership join to `programs.user_id` — the same gate the
 * forward ops use — and must never assume a ticket's ids belong to the ticket's
 * `programId`, let alone to the caller.
 *
 * ## Not reusing the proposal vocabulary
 *
 * `lib/patch-proposal.ts` already models a patch as `{ tool, args }` and
 * `db/patch-proposals.ts` already applies batches of them. Tempting, and wrong:
 * that vocabulary is position-addressed by construction (`positionField`), so
 * reusing it would inherit precisely the bug this module exists to prevent.
 * Proposals describe an edit nobody has made yet; inverses describe an edit
 * that already happened to specific rows. Different addressing, on purpose.
 *
 * ## Scope today
 *
 * Only the `move_*` family is wired. Every other mutating action either sits in
 * {@link EDIT_GUARDS} at a deliberate non-`undo` guard or falls to the fail-safe
 * `confirm` default in {@link guardFor} until it is wired here on purpose.
 * `docs/specs/program-edit-undo.md` carries the roadmap and the inverse shapes
 * the remaining ops will need — including the tagged before-image the per-week
 * override ops are waiting on.
 */

// ---------------------------------------------------------------------------
// Guard policy — which edits get Undo, which keep a modal, which get neither
// ---------------------------------------------------------------------------

/**
 * How a destructive-or-surprising edit is protected.
 *
 * - `undo` — apply immediately, offer a timed Undo. For edits that are cheap,
 *   frequent, and fully reversible. A confirm dialog on these would tax the
 *   common case to insure the rare one.
 * - `confirm` — block on a modal BEFORE applying, and offer no Undo. For edits
 *   whose reversal would mean restoring a whole subtree: the honest answer is
 *   to ask first, not to promise a restore the undo layer should not be
 *   carrying around in memory.
 * - `none` — no guard. The edit is deliberate and its own control is the way
 *   back, or it is not a user edit at all.
 */
export type EditGuard = 'undo' | 'confirm' | 'none'

/**
 * `program_events.action` → its guard. This table is the single source of truth
 * for every edit surface: a surface derives its affordance from
 * {@link guardFor} and never decides locally. That is what stops one layout
 * growing an Undo bar the other lacks.
 *
 * Engine-authored actions are classified `none` EXPLICITLY, never left to the
 * fallback: they are not edits anyone made, so there is nothing to take back,
 * and `confirm` — a policy meant for destructive user edits — would be the
 * wrong answer arrived at by omission.
 *
 * The scope of this table is every `action` `src/db/program-patches.ts` emits —
 * the granular editor ops. The `add_*` / `update_*` / `remove_program_{set,
 * exercise}` families are the only ones still unlisted, and they sit on the
 * `confirm` fallback ON PURPOSE until their before-images are designed; the
 * spec's roadmap names the inverse each one needs. Program-LIFECYCLE actions
 * emitted elsewhere in `src/db/` (`upsert_program`, `set_program_status`,
 * `adopt_program`, `decline_program`, `restart_program`, `update_description`,
 * `adopt_template`, `set_program_visibility`, `adopt_shared_program`,
 * `propose_program_patches`, `confirm_patch_proposal`, `decline_patch_proposal`)
 * are out of scope entirely — they are not editor ops, they own their own
 * confirmation surfaces, and the fallback is the right answer for them.
 */
export const EDIT_GUARDS = {
  // Order changes: the archetypal cheap, reversible, frequent edit — and the
  // only family wired today.
  move_program_day: 'undo',
  move_program_exercise: 'undo',
  move_program_set: 'undo',
  // Removing a day discards every exercise, set, per-week override and muscle
  // tag beneath it. Ask first; do not carry that subtree in a toast.
  remove_program_day: 'confirm',
  // Program-level policy switches are deliberate, rare, and visible in their
  // own control — the control itself is the affordance to switch back.
  set_program_autoregulation: 'none',
  set_program_deload_policy: 'none',
  set_program_diet_phase: 'none',
  set_program_overshoot_policy: 'none',
  set_program_plan_sync: 'none',
  // A training max moves through one sanctioned, reason-stamped path and is
  // read back by the progression engine. Re-entering the prior number is the
  // reversal; a silent one would muddy the reason trail.
  adjust_training_max: 'none',
  // The engine's own write, not a user edit. Listed explicitly so it takes the
  // engine policy rather than the destructive-edit fallback: a stray Undo bar
  // on a plan sync would offer to fight the thing that wrote it.
  sync_plan_to_performance: 'none',
  // The per-week override pair. `confirm` is a DELIBERATE placeholder, not the
  // fallback: both ops want `undo` eventually, and neither can have it until
  // the before-image below is built.
  //
  // `program_set_overrides` is keyed `(program_set_id, week)` and every field on
  // it is nullable, so the inverse must distinguish two states that a flat
  // field bag renders identically: NO ROW existed for this week, versus a row
  // existed whose fields were explicitly null. Restore the wrong one and the
  // week silently keeps — or silently loses — a pin. Worse, `setProgramSetOverride`
  // MERGES a partial patch over whatever it finds, and deletes the row outright
  // once every field lands null, so a single call can move between those states
  // in either direction.
  //
  // The fix is a tagged before-image, `{ existed: false } | { existed: true;
  // fields: <all ten, nulls included> }` — absence carried out of band on a
  // discriminant, never inferred from nullness — applied ABSOLUTELY (delete, or
  // upsert the full field set) and never re-merged. The spec's §05 roadmap
  // fixes the shape; these two move to `undo` once it exists.
  set_program_set_override: 'confirm',
  remove_program_set_override: 'confirm',
} as const satisfies Record<string, EditGuard>

/** An action this table classifies explicitly. */
export type GuardedEditAction = keyof typeof EDIT_GUARDS

/** The actions that mint tickets — narrower than `GuardedEditAction`, and the
 *  type an {@link UndoTicket} carries. */
export type UndoableEditAction = {
  [K in GuardedEditAction]: (typeof EDIT_GUARDS)[K] extends 'undo' ? K : never
}[GuardedEditAction]

/**
 * The guard for one action. Unclassified actions fall to `confirm`: a mutating
 * op nobody has classified is treated as the expensive kind until someone
 * decides otherwise, so forgetting this table fails safe rather than silently
 * shipping an unguarded edit.
 */
export function guardFor(action: string): EditGuard {
  return (EDIT_GUARDS as Record<string, EditGuard>)[action] ?? 'confirm'
}

/** True when the action's edits are taken back with a timed Undo. */
export function isUndoable(action: string): action is UndoableEditAction {
  return guardFor(action) === 'undo'
}

// ---------------------------------------------------------------------------
// The inverse vocabulary
// ---------------------------------------------------------------------------

/** The three levels of the program tree an inverse can address. */
export type NodeLevel = 'day' | 'exercise' | 'set'

/** One row, named the only way that survives a renumber. */
export interface NodeRef {
  level: NodeLevel
  /** The row's stable uuid — `program_days.id` / `program_exercises.id` /
   *  `program_sets.id`, per `level`. */
  id: string
}

/**
 * The inverses this module can express. One kind today; the spec fixes the
 * shapes the reinsert/restore kinds take when their ops are wired.
 */
export type InverseOp =
  /** Undoes a `move_*`: put `node` back immediately after `after`, or first
   *  when `after` is null. */
  { kind: 'reorder'; node: NodeRef; after: string | null }

/**
 * What a completed, undoable edit hands back. Held in client memory for one
 * toast; never persisted, never written to `program_events`.
 *
 * Applying a ticket APPENDS its own event row — the change log stays
 * append-only, so an undo reads as "moved it back", not as though the original
 * move never happened.
 */
export interface UndoTicket {
  programId: string
  /** The action being taken back, so the apply path can re-check the guard and
   *  every surface can label its toast from one vocabulary. */
  action: UndoableEditAction
  /** `programs.updated_at` as this op left it, ISO-8601 — the CAS gate. */
  revision: string
  /** What moved, by display name — the exercise or day name, or the owning
   *  exercise's name for a set. */
  subject: string
  /** Where it landed, 1-based, for the sentence. */
  toPosition: number
  inverse: InverseOp
}

/*
 * The ticket carries SUBJECT AND POSITION, never a finished sentence: the
 * server has no business writing display copy when locale lives on the user
 * (see the i18n decision — next-intl, locale on the user, never in the URL).
 * Each surface renders "Moved Lat Pulldown to 4th" from its own message
 * catalogue keyed by `action`, which is also what keeps the wording identical
 * across surfaces.
 */

// ---------------------------------------------------------------------------
// Anchoring — the position → id translation
// ---------------------------------------------------------------------------

/**
 * The uuid `nodeId` sat immediately after in `orderedIds`, or `null` when it
 * sat first. `orderedIds` is the sibling order BEFORE the op ran.
 *
 * This is the whole position-to-anchor translation. It is well-defined because
 * moving one node never changes the relative order of the others: whatever
 * preceded it beforehand is still a real, still-adjacent row afterwards, so
 * "put it back after that one" reconstructs the prior order exactly. If that
 * predecessor is itself moved or deleted later the reconstruction would be
 * wrong — which is exactly the case {@link isTicketFresh} refuses.
 *
 * Throws when `nodeId` is not in the list: a caller computing an anchor from
 * the wrong sibling set has a bug, and inventing `null` would silently mean
 * "restore to first".
 */
export function anchorBefore(orderedIds: readonly string[], nodeId: string): string | null {
  const index = orderedIds.indexOf(nodeId)
  if (index === -1) {
    throw new Error(`anchorBefore: ${nodeId} is not among its siblings`)
  }
  return index === 0 ? null : orderedIds[index - 1]
}

/**
 * Where an anchored node lands — the read side of {@link anchorBefore}, used by
 * the apply path to turn an anchor back into a 0-based target index.
 *
 * `orderedIds` is the CURRENT sibling order with the moved node ALREADY
 * REMOVED, so the returned index is a plain splice point: `null` (restore to
 * first) is 0, otherwise the slot just after the anchor.
 *
 * Returns `null` when the anchor has vanished, which the caller must treat as
 * "refuse", never as "append".
 */
export function indexForAnchor(orderedIds: readonly string[], after: string | null): number | null {
  if (after === null) return 0
  const index = orderedIds.indexOf(after)
  return index === -1 ? null : index + 1
}

// ---------------------------------------------------------------------------
// Freshness — the compare-and-swap gate
// ---------------------------------------------------------------------------

/**
 * How long a ticket is offered before the toast drains and it is discarded.
 * Matches the logger's undo window so the two reversals feel like one idea.
 */
export const UNDO_WINDOW_MS = 8_000

/**
 * True while the program has not been written since the ticket's own op.
 *
 * Deliberately coarse: it compares the whole program's `updated_at`, not the
 * touched subtree, so an unrelated edit elsewhere in the program also
 * invalidates the ticket. Over an eight-second window that costs a rare
 * "couldn't undo that" and buys immunity to every interleaving-writer bug we
 * would otherwise have to reason about one op at a time — including the coach
 * agent, which can write to the same program at any moment without the editor
 * knowing.
 *
 * Compares instants, not strings, so an equal time in a different ISO spelling
 * (`+00:00` vs `Z`, differing fractional-second digits) still counts as fresh.
 * An unparseable value on either side is not fresh.
 */
export function isTicketFresh(ticket: UndoTicket, currentRevision: string): boolean {
  const minted = Date.parse(ticket.revision)
  const current = Date.parse(currentRevision)
  if (Number.isNaN(minted) || Number.isNaN(current)) return false
  return minted === current
}

// ---------------------------------------------------------------------------
// Ticket construction
// ---------------------------------------------------------------------------

/** Everything the db layer gathers, inside its transaction, to mint one. */
export interface TicketInput {
  programId: string
  action: string
  /** `programs.updated_at` AFTER the op's own bump. */
  revision: string
  subject: string
  toPosition: number
  inverse: InverseOp
}

/**
 * Mints a ticket, refusing any action the guard table does not mark `undo`.
 *
 * The refusal is the point: it is the one place that stops a well-meaning
 * caller handing back a ticket for `remove_program_day` (whose subtree belongs
 * behind a modal) or for an engine write. A db op that wants to become
 * undoable has to change {@link EDIT_GUARDS} first, in the open.
 */
export function mintUndoTicket(input: TicketInput): UndoTicket | null {
  if (!isUndoable(input.action)) return null
  return {
    programId: input.programId,
    action: input.action,
    revision: input.revision,
    subject: input.subject,
    toPosition: input.toPosition,
    inverse: input.inverse,
  }
}

// ---------------------------------------------------------------------------
// Apply-time verdicts
// ---------------------------------------------------------------------------

/**
 * Why an undo did not happen. Surfaces render these as one quiet line in the
 * toast's place; none of them means the user did anything wrong.
 */
export type UndoRefusal =
  /** The window closed, or another writer touched the program. */
  | 'stale'
  /**
   * The anchor, or the row itself, is gone — undone twice, or deleted since.
   *
   * Also the refusal an OWNERSHIP failure takes in the apply path. There is no
   * separate "not yours" verdict on purpose: a distinct one would confirm that
   * a guessed uuid exists, and this repo's not-found economy already answers
   * unowned and absent identically everywhere else.
   */
  | 'vanished'
  /**
   * The ticket's action is not classified `undo` — a ticket minted before a
   * policy change, or one forged by a client. NOT an ownership verdict: the
   * ownership re-resolve lives in the db apply path (see the security note) and
   * reports `vanished`.
   */
  | 'not-undoable'

export type UndoOutcome = { ok: true } | { ok: false; reason: UndoRefusal }

/**
 * The refusal for a ticket not worth attempting, checked before any database
 * work. Returns null when the ticket is still worth a try.
 *
 * Freshness is re-checked inside the apply transaction as well — this is the
 * cheap early out, not the gate. It checks POLICY and FRESHNESS only: ownership
 * is unreachable from here and remains the apply path's job.
 */
export function precheckTicket(ticket: UndoTicket, currentRevision: string): UndoRefusal | null {
  if (!isUndoable(ticket.action)) return 'not-undoable'
  return isTicketFresh(ticket, currentRevision) ? null : 'stale'
}
