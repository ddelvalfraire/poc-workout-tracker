# Program Edit Undo

Taking back a granular program edit. Establishes that undo is built (not killed), fixes the vocabulary an inverse is expressed in, and settles the two things that would otherwise make it unsafe: `program_events` cannot invert an op, and position-addressed ops cannot be inverted numerically.

- Status: decided / contract landed (`src/lib/program-undo.ts`) / db + UI wiring outstanding
- Date: 2026-08-22

## 01 · The question

The editor mocks show an Undo affordance — *"Moved Lat Pulldown to 4th — Undo"* — and no undo, inverse-op, or transaction capability exists anywhere in the MCP tools or the db layer. The editor is moving to **granular ops**: it will emit add/update/remove/move patches rather than whole-program replaces.

That cuts both ways. Each op is small and individually addressable, which makes an inverse tractable. But there is also no explicit Save, so there is no draft to abandon: every change is committed the moment it is made. The affordance in the mock is not decoration — without it the editor has no escape hatch at all.

Three options were weighed:

- **(a)** A real inverse-op layer, with before-images written into `program_events`.
- **(b)** A short-lived undo that replays an inverse and is abandoned on navigation.
- **(c)** No undo — rely on the edit being cheap to redo by hand, and delete the affordance from the designs.

## 02 · What `program_events` actually stores

The change log is a **narrative, not a journal**. Auditing every `recordProgramEvent` call in `src/db/program-patches.ts`:

| Action | Payload | Invertible from the log? |
|---|---|---|
| `update_program_set` | `before` (touched fields) + `after` | **Yes** |
| `adjust_training_max` | `before.trainingMaxKg` + `after` | **Yes** |
| `update_program_exercise` | `before` (identity only) + `after` | Partly — progression/superset have no before |
| `update_program_day` | `after: values` | No |
| `add_program_*` | `after` | Yes (by construction — delete the new row) |
| `move_program_*` | `{ from, to }` | Numerically only — see §04 |
| `remove_program_set` | `{ setNumber }` | **No.** Targets, technique and per-week overrides are gone |
| `remove_program_exercise` | `before: { name }` | **No.** Every set beneath it is gone |
| `remove_program_day` | `{ dayPosition }` | **No.** The whole subtree is gone |
| `set_program_*` policies | `after` only | No |
| `set_program_set_override` | `{ week, setNumber, after: values, cleared }` | **No.** `after` is the partial patch; it is merged over a row the log never captured, and `cleared: true` means the row was deleted outright |
| `remove_program_set_override` | `{ week, setNumber }` | **No.** The whole override row is gone |
| `sync_plan_to_performance` | `after` | n/a — engine-authored, nothing to take back |

So the log records enough to **describe** a change and not enough to **undo** one. Two ops out of seventeen carry a usable before-image, and the destructive ops — precisely the ones a user most wants back — carry the least.

This is not an oversight to correct. `src/db/program-events.ts` says so in its own contract: *"Minimal before/after of the touched fields — never a whole-program snapshot."* Making removals log their subtree would turn an append-only human-readable narrative into a backup mechanism, changing what the table is, inflating every destructive write, and inviting "undo something from last Tuesday" — which collides head-on with the standing law that **prescriptions are snapshotted facts, never re-derived**.

> **Decision.** `program_events` stays a narrative. Undo carries its own before-image, computed at mutation time and never persisted. This rules out **(a)**.

## 03 · Decision

**Build (b).** Rejecting (c) as well:

- The guard research is right that a confirm dialog on a cheap, frequent, reversible edit taxes the common case to insure the rare one. Delete-set and delete-exercise want undo, not a modal.
- With granular ops and no Save, "cheap to redo by hand" is false for the two edits users actually fat-finger — a reorder (redoing means reconstructing an order you can no longer see) and a set deletion (redoing means retyping targets that are gone).

The shape:

> An op that can be taken back returns an **`UndoTicket`** computed by the server **inside the mutation's own transaction** — the only moment the before-image is guaranteed both correct and free to read. The client holds it in memory for the length of one toast and discards it on navigation. Nothing is persisted. Undo is a few seconds of grace, not a revision history.

Applying a ticket **appends** its own `program_events` row. The log stays append-only: an undo reads as "moved it back", never as though the original move never happened.

## 04 · The position-addressing problem, and the fix

Every patch op addresses by `programId` + 0-based `dayPosition` / `exercisePosition` + 1-based `setNumber`, and **every op renumbers its siblings** to keep positions contiguous. That makes the numeric inverse wrong:

> Undoing "move day 3 → 1" is **not** "move day 1 → 3". If anything else moved in between, replaying the numeric mirror silently reorders the wrong rows. Positions describe a moment; they cannot survive one.

Two independent defences, both in `src/lib/program-undo.ts`:

**1. Anchor by id, never by position.** Every row already has a stable uuid. An inverse names the uuid it acts on and, for order restoration, the uuid of the sibling it *used to follow* (`after`, with `null` meaning "was first"). `anchorBefore()` computes it from the pre-op sibling order; `indexForAnchor()` resolves it back to a splice point at apply time, returning `null` — refuse — when the anchor has vanished. This is well-defined because moving one node never changes the relative order of the others.

The workout logger already reaches for this defence (`handleUndoRemove` re-resolves index by stable id before applying); this makes it the rule rather than a local trick.

**2. Compare-and-swap on the program.** Every patch op bumps `programs.updated_at`. A ticket records the stamp its own op left behind, and undo applies only while that value is untouched.

Deliberately coarse — it compares the **whole program**, not the touched subtree — so an unrelated edit elsewhere also invalidates the ticket. Over an eight-second window that costs a rare "couldn't undo that" and buys immunity to every interleaving-writer case without reasoning about them one op at a time. That matters here specifically because **the coach agent can write to the same program at any moment** without the editor knowing, as can a second tab or another device.

The id anchors are belt to the CAS's braces: CAS alone would let a numeric inverse work, but anchors make a mis-applied inverse impossible to *express* rather than merely unlikely to occur.

### One ticket per gesture — the CAS in a batch

Comparing the whole program has a consequence worth stating outright rather than leaving anyone to discover it: in a **multi-op batch** — a multi-patch coach proposal, or a single UI gesture that fires several moves — op 2's bump invalidates op 1's ticket the moment it lands. Only the last op in a batch can ever produce a usable ticket.

> **That is the intended semantics.** Undo takes back **the last thing**, never a fragment of a compound edit. A partially-undone batch is a worse outcome than an un-undoable one, and reasoning about per-op tickets inside a batch is exactly the interleaving-writer analysis the coarse CAS exists to avoid.

It obliges callers, so it is a rule:

1. A caller running several ops as one gesture mints **at most one ticket**, computed after the final bump and describing the gesture as a whole. Minting per-op and keeping the last is the same rule done wastefully; keeping the **first** is a bug that hands back a ticket guaranteed to refuse as `stale`.
2. A gesture whose reversal is not expressible as a single `InverseOp` mints **nothing**, and takes the guard its most expensive op takes.
3. Batch proposal application is out of scope: `confirm_patch_proposal` is not in `EDIT_GUARDS`, falls to `confirm`, and never mints.

### Not reusing the proposal vocabulary

`src/lib/patch-proposal.ts` already models a patch as `{ tool, args }`, and `src/db/patch-proposals.ts` already applies batches. Reusing it would be wrong: that vocabulary is position-addressed by construction (`positionField`), so it would inherit the exact bug above. Proposals describe an edit nobody has made yet; inverses describe an edit that already happened to specific rows.

### Security

A ticket travels through the client, so **every uuid inside it is attacker-controlled input**. The apply path must re-resolve every id through the ownership join to `programs.user_id` — the same gate the forward ops use — and must never assume a ticket's ids belong to the ticket's `programId`, let alone to the caller. `precheckTicket()` re-checks the guard table at apply time so a forged or stale-policy ticket cannot slip past.

## 05 · The guard split

`EDIT_GUARDS` in `src/lib/program-undo.ts` is the **single source of truth**. A surface derives its affordance from `guardFor()` and never decides locally.

| Guard | Meaning | Actions |
|---|---|---|
| `undo` | Apply immediately, offer a timed Undo | `move_program_day` · `move_program_exercise` · `move_program_set` |
| `confirm` | Modal **before** applying, no Undo | `remove_program_day` — its whole subtree (exercises, sets, per-week overrides, muscle tags) dies with it · `set_program_set_override` · `remove_program_set_override` — see the override note below |
| `none` | No guard; the control itself is the way back, or it is not a user edit | the five `set_program_*` policies · `adjust_training_max` · `sync_plan_to_performance` |

Unclassified actions **fall to `confirm`**. A new mutating op nobody has classified is treated as the expensive kind until someone decides otherwise, so forgetting the table fails safe rather than shipping an unguarded edit.

Engine-authored actions are classified **`none` explicitly, never by omission**. `sync_plan_to_performance` and the autoregulation write are not edits anyone made, so there is nothing to take back and a stray Undo would fight the engine — but `confirm` is a policy for destructive *user* edits, and letting an engine write reach it through the fallback would be the wrong answer arrived at by accident. Sitting in the table is what makes the classification reviewable.

Scope of the table is every action `src/db/program-patches.ts` emits. Program-**lifecycle** actions emitted elsewhere in `src/db/` (`upsert_program`, `set_program_status`, `adopt_program`, `decline_program`, `restart_program`, `update_description`, `adopt_template`, `set_program_visibility`, `adopt_shared_program`, `propose_program_patches`, `confirm_patch_proposal`, `decline_patch_proposal`) are out of scope — they are not granular editor ops, they own their own confirmation surfaces, and the `confirm` fallback is the right answer for them.

### The per-week overrides: absence is not a null

`set_program_set_override` and `remove_program_set_override` sit at **`confirm` deliberately**, not by fallback. Both *want* `undo` — a pinned week's targets are exactly the kind of thing that is painful to retype — and neither may have it until the before-image below exists.

`program_set_overrides` is keyed `(program_set_id, week)`, and every field on it is nullable. So an inverse must distinguish two states that a flat field bag renders identically:

- **no row existed** for that week (the week runs on the engine-derived prescription), versus
- **a row existed whose fields were explicitly null** (a partial pin, with the rest deliberately unset).

Restore the wrong one and the week silently keeps — or silently loses — a pin, with no error anywhere. The forward op makes it worse in both directions: `setProgramSetOverride` **merges** a partial patch over whatever it finds, and **deletes** the row outright once every merged field lands null (`cleared: true`). One call can move between the two states either way.

> **Decision — the before-image is tagged, and applied absolutely.**
>
> ```ts
> type OverrideBefore =
>   | { existed: false }
>   | { existed: true; fields: Record<OverrideField, ... | null> } // all ten, nulls included
> ```
>
> Absence is carried **out of band on a discriminant**, never inferred from nullness. The inverse applies it **absolutely** — `existed: false` deletes any row at `(program_set_id, week)`; `existed: true` upserts the full field set, nulls and all — and **never re-merges**, because merging would resurrect a value the forward op nulled.

Until that lands, both ops keep `confirm`. Nothing reads `guardFor()` yet, so the conservative placeholder costs nothing today; it must be revisited before the override editor ships, since a modal on every week-pin is precisely the tax on the common case this design otherwise rejects.

### Roadmap

Only the `move_*` family is classified `undo` today. Remaining ops move there as they are wired, each needing one inverse kind:

| Ops | Inverse kind | Before-image the mutation must capture |
|---|---|---|
| `add_program_{day,exercise,set}` | `delete` | none — the new row's id |
| `update_program_{day,exercise,set}` | `restoreFields` | touched fields' prior values **and** the values the op wrote, for a per-field CAS |
| `remove_program_set` | `reinsertSet` | the full set row + its `program_set_overrides`; needs `.returning()` widened from `{ id }`. Each week's overrides carry the **same absence-vs-value trap** as above: snapshot the rows that existed, keyed by week, and reinsert only those — a week with no row must come back with no row, not with a row of nulls |
| `remove_program_exercise` | `reinsertExercise` | the exercise + every set + overrides (same per-week absence-vs-value rule). Muscle tags are **not** snapshotted — they re-derive from `(source, wgerExerciseId)`, so a stale copy can't outlive a catalog correction |
| `set_program_set_override` · `remove_program_set_override` | `restoreOverride` | the tagged `OverrideBefore` above — `{ existed: false }`, or `{ existed: true; fields }` with all ten fields including nulls — applied absolutely, never merged |

`remove_program_day` stays on `confirm` permanently. That subtree does not belong in a toast.

## 06 · What the UI is allowed to show

**The Undo bar stays in the designs**, with these rules.

1. **It is not mobile-only.** The mock shows it on mobile only; that is a spec bug, not a platform constraint. There is exactly one layout family in this codebase — mobile-first, `max-w-md`, no `useMediaQuery`, and the only viewport branch repo-wide is a `lg:hidden` in the legal pages. Undo is surface-agnostic and derives from `guardFor()`, so no layout can grow the affordance while another lacks it.

2. **`SessionToast` is the primitive.** `src/app/workout/new/session-toast.tsx` already solves this exact problem: countdown, hover/`focus-within` pause, reduced-motion fallback, `role="status"` announce-on-entry, single-fire expiry. The `reversal` button variant already exists and its comment already names Undo. When the editor is built, promote `SessionToast` to `src/components/` with a `.stories.tsx` (per `CLAUDE.md`) rather than growing a second toast.

3. **The window is `UNDO_WINDOW_MS` (8s)**, matching the logger so the two reversals feel like one idea.

4. **The server never writes the sentence.** A ticket carries `subject` and `toPosition`, not display copy — locale lives on the user (next-intl), so each surface renders "Moved Lat Pulldown to 4th" from its own catalogue keyed by `action`. This is also what keeps the wording identical across surfaces.

5. **Refusals are quiet, not errors.** `stale` (window closed or someone else wrote), `vanished` (anchor or row gone — undone twice, or deleted since) and `not-undoable` (the ticket's action is not classified `undo`: policy changed under it, or a client forged it) render as one calm line in the toast's place. None of them means the user did anything wrong.

   There is deliberately **no ownership verdict** in the vocabulary. `precheckTicket()` checks policy and freshness only; the ownership re-resolve lives in the db apply path and reports **`vanished`**, because a distinct "not yours" would confirm that a guessed uuid exists, and the repo's not-found economy already answers unowned and absent identically everywhere else.

6. **A `confirm` action must not show an Undo bar**, and an `undo` action must not show a confirm dialog. The two are alternatives, never layered.

## 07 · What is landed

- `src/lib/program-undo.ts` — the guard table, the id-anchoring translation, the CAS freshness gate, ticket minting, and the refusal vocabulary. Pure; 27 tests in `src/lib/program-undo.test.ts`.

Outstanding, in order:

1. `bumpUpdatedAt` returns its stamp; the three `move_*` ops capture pre-op sibling order, compute the anchor, and return a ticket. Touches the `program-patches.test.ts` mock harness, which asserts the current `{ moved: true }` return shape.
2. `src/db/program-undo.ts` — the apply path. Applying a `reorder` resolves the anchor to a target position and **delegates to the existing `moveProgram*` function**, so the splice-renumber logic is not duplicated.
3. The server action, and the editor surface that shows the bar.
