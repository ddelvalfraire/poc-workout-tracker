# Program lifecycle — surface direction

Every transition a program can make between `proposed`, `draft`, `active` and
`archived` — plus the two hard deletes — given a designed surface: where the
control lives in the IA, what it says, what the confirm names, and what happens
when it fails.

- Status: draft / code-verified / partial implementation (see §03 ledger)
- Date: 2026-08-22
- Companion to [program-lifecycle.prd.md](program-lifecycle.prd.md), which
  argued the model (clone-per-block, single-active). This document specifies the
  surfaces that model needs and never had.
- Contracts: [DESIGN.md](../../../DESIGN.md) de-card vocabulary; keys follow
  [docs/I18N-KEYS.md](../../../docs/I18N-KEYS.md)
- Source of truth for behaviour: `src/db/programs.ts`, `src/db/prescriptions.ts`,
  `src/lib/mcp/program-tools.ts`, `src/db/schema.ts`

> Surfaces only. No component code, no schema change. Where a surface already
> ships, this records it as shipped and specifies the delta; where it does not,
> this is the build order.

## 01 · The state machine, as the code actually implements it

Four statuses. Not a free graph — several edges are structurally impossible and
two transitions are hard deletes.

```
                 adoptProgram(activate: false)
   ┌──────────┐ ───────────────────────────────▶ ┌─────────┐
   │ proposed │                                  │  draft  │
   └──────────┘ ──────┐                          └─────────┘
        │             │ adoptProgram(activate: true)   │  ▲
        │             │                                │  │ setProgramStatus('draft')
        │             ▼                                ▼  │
        │      ┌──────────┐  setProgramStatus('active') │  │
        │      │  active  │ ◀───────────────────────────┘  │
        │      └──────────┘                                │
        │             │ setProgramStatus('archived')       │
        │             ▼                                    │
        │      ┌──────────┐ ─────────────────────────────► ┘
        │      │ archived │ ══▶ deleteProgram()  HARD DELETE
        │      └──────────┘
        │
        └── declineProgram()  ══▶ HARD DELETE
```

Verified facts, each load-bearing for a surface below:

| # | Fact | Where |
|---|---|---|
| F1 | `declineProgram` is a **hard delete**. It records a `decline_program` event and then `DELETE FROM programs` **in the same transaction** — so the event it just wrote cascades away with the row. Nothing survives. | `src/db/programs.ts` `declineProgram` |
| F2 | `adoptProgram(userId, id, activate)` forks on a boolean: `true` → `active`, `false` → `draft`. There is no third landing. | `adoptProgram` |
| F3 | **Activating anything archives every other active program.** Both `setProgramStatus(…, 'active')` and `adoptProgram(…, true)` run the same sibling sweep after the ownership gate. | `setProgramStatus`, `adoptProgram` |
| F4 | The sweep is **not transactional and logs no event on the swept program**. A sweep failure leaves two actives; the home hero then tiebreaks on `updatedAt`. The archived sibling's timeline never mentions it. | `setProgramStatus` — "the archived SIBLINGS get no event of their own" |
| F5 | `setProgramStatus` **refuses** a `proposed` row with `ProposedProgramError`. So do `updateProgram` (owner path), `updateProgramDescription`, and `cloneProgram`. | the `ne(programs.status, 'proposed')` gates |
| F6 | A `proposed` program derives **nothing**: `deriveDay` throws `ProposedProgramError` before any prescription is computed. A proposal cannot be trained, previewed as targets, or instantiated. | `src/db/prescriptions.ts:525-527` |
| F7 | `restart_program` = `cloneProgram` (row-for-row: days, exercises, supersets, sets, per-week overrides, muscle tags) named by `nextBlockName` → `"Name — Block 2"`, **then** `setProgramStatus('active')` on the clone. Two steps; the clone commits first, so a failed activate leaves a harmless draft. | `program-tools.ts` `restart_program`, `cloneProgram` |
| F8 | Restart **carries training maxes forward** — one `setTrainingMax(reason: 'block-restart')` per clean AMRAP-cycle lift, applied inside the clone transaction. `bankedWaves` **resets to 0**. Stalled (M4-flagged) lifts are **skipped** — their TM stays put. A mismatched address skips silently rather than failing the restart. | `cloneProgram` `options.tmIncrements`, `restartTmPlan` |
| F9 | Restart does **not** carry: `dietPhase`/`dietPhaseSetAt` (a fact about the lifter, not the plan), `visibility` (the clone lands `private`), `authorActor` (the clone is owner-authored), and the source's workouts/stats (they stay on the source). | `cloneProgram` insert |
| F10 | Deleting a program cascades: `program_days` → exercises → sets → per-week overrides → muscle tags, plus `program_events` (the whole timeline), `program_shares` (a live share URL dies), `program_patch_proposals` (pending coach changes), and `notes` attached to the program. | `src/db/schema.ts` FKs |
| F11 | Logged **workouts survive** a delete — `workouts.program_day_id` is `ON DELETE SET NULL`. They keep their sets and volume but lose which day and which block they came from. | `src/db/schema.ts:49-50` |
| F12 | `cloneProgram` refuses a `proposed` source (`ProposedProgramError`) — a proposal cannot be laundered into an owner draft via restart. | `cloneProgram` |

**Impossible edges — draw no control for them:** `proposed → archived`,
`proposed → active` other than via `adoptProgram`, `archived → proposed`,
`draft → proposed`. The only way into `proposed` is a coach `saveProgram`.

## 02 · Standing rules this direction applies

Established research, treated as given. Every string below is checked against
all six.

1. **Name the concrete thing.** "Archive Volume Cut · Block 2", never "this and
   following" or "the other program".
2. **State what is PRESERVED**, not what is forbidden. Every destructive or
   side-effecting confirm carries a preservation clause.
3. **Never say "locked" or "disabled".** A refusal explains the next move.
4. **Undo for cheap reversible acts; a confirm dialog only for expensive ones.**
   Expensive = irreversible, or reversible only by redoing work.
5. **A destructive confirm states the consequence in counts** — "this also
   removes 2 week-overrides" — not a vague "cannot be undone" alone.
6. **The destructive control is spatially separated from the safe one**, and the
   safe one holds initial focus.

Cost classification used throughout:

| Transition | Cost | Surface |
|---|---|---|
| Adopt as draft | cheap | direct + success toast |
| Adopt & activate — no other active | cheap, reversible | direct + success toast |
| Adopt & activate — another active exists | **side-effecting**: archives a live block | confirm naming the victim |
| Activate a draft — no other active | cheap, reversible | direct + undo toast |
| Activate a draft — another active exists | **side-effecting** | confirm naming the victim |
| Leave (active → archived) | cheap, reversible | confirm (shipped; a mid-block pause earns it) |
| Un-archive → active | as activate | as activate |
| Un-archive → draft | cheap, reversible | direct + undo toast |
| Restart block | expensive — mints a block, archives the source, moves TMs | confirm (shipped) |
| Decline proposal | **irreversible hard delete** | confirm, destructive voice, counts |
| Delete program | **irreversible hard delete** | confirm, destructive voice, counts |

## 03 · Implementation ledger

What already ships, so a builder knows the delta.

| Transition | Surface today | This direction |
|---|---|---|
| T1 Adopt as draft | `proposal-actions.tsx` — "Adopt as draft", outline | keep; rename the verb, add the success toast, specify error states |
| T2 Adopt & activate | `proposal-actions.tsx` — volt CTA, **silent sweep** | **add the sweep confirm** when another active exists |
| T3 Decline | `proposal-actions.tsx` + `ConfirmDialog` | **rewrite the body** — it never says what is destroyed |
| T4 Activate a draft | `program-actions.tsx` — bare "Activate", no confirm, **silent sweep** | **new confirm**, new undo toast |
| T5 Leave | `program-actions.tsx` + confirm; body already preserves | keep; name the program, drop the destructive ink |
| T6 Un-archive | reuses the same bare "Activate"; **no archived → draft path exists** | **new "Move to drafts"**; archived roll-up gains a provenance suffix |
| T7 Delete | `program-actions.tsx` + confirm; body is a generic "cannot be undone" | **rewrite with consequence counts** |
| T8 Restart block | `restart-program-button.tsx`, detail page Manage cluster only | keep the dialog; **add the two entry points the mocks imply** |
| T9 Proposed refusals | rows are pure navigation; detail swaps `ProgramActions` for `ProposalActions` wholesale | keep (it is structural); specify the MCP-race error state |

## 04 · IA map

Three surfaces own lifecycle. Nothing else may.

```
/programs                        the LIST — zones, never lifecycle controls
  ├ hero (the one active)        → block-complete line gains a restart LINK (not the action)
  ├ zone "Needs your decision"   proposed rows → navigate to detail
  ├ zone "Also active"           the two-active anomaly (F4), rows only
  ├ zone "Drafts"                rows only
  ├ ActivationDoors
  └ <details> "Archived · N"     rows only

/programs/[id]                   the DETAIL — the single home of every transition
  ├ status === 'proposed'   →  ProposalActions   (save as draft | start this block | decline)
  └ otherwise               →  ProgramActions    (edit | activate/leave | move to drafts | restart | delete)

/programs/[id]/stats             read-only; no lifecycle controls, ever
```

**Rule: a list row never carries a lifecycle control.** Rows are navigation.
This is what structurally satisfies F5 — a `proposed` row physically cannot
offer archive or activate, because no row offers anything.

`ProgramActions` renders under the shipped caps header **Manage**
(`ProgramDetail.manageTitle`) on a hairline, per the de-card contract. One volt
per screen: on a `draft`/`archived` page the volt is **Activate**; on an
`active` page the week hero has already spent it, so every Manage control is
`outline` or `ghost`.

## 05 · T1 / T2 — Adopting a proposal

**Where:** `/programs/[id]`, `status === 'proposed'`. `ProposalActions` replaces
`ProgramActions` entirely, under the shipped proposal eyebrow and lede
(`ProgramDetail.proposal.*`), which already says the right thing: *"Review the
plan below, then adopt it as a draft, start it right away, or decline. Nothing
trains until you confirm."*

**Control:** two explicit adopt buttons — never one button plus a checkbox. The
fork in `adoptProgram`'s `activate` boolean (F2) is a real product question
("do I start this now, or shelve it?") and must be asked as two verbs.

```
[ Start this block ]  [ Save as draft ]              [ Decline ]
   volt, flex-1        outline, flex-1        ghost, destructive ink,
                                              ml-auto, spatially separated
```

Naming: prefer **"Start this block"** to "Adopt & activate" and **"Save as
draft"** to "Adopt as draft". *Adopt* is our internal word for a status
transition, not a lifter's word for beginning training.

### T1 · Save as draft — cheap, direct

No dialog. On success `router.refresh()` (the page becomes an ordinary draft
detail page) plus a toast:

> **Volume Cut · Block 3 is in your drafts.** — *Open drafts*

**No Undo affordance**, deliberately. F5 makes `proposed` unreachable once left:
a program that has been adopted can never return to awaiting-decision. Shipping
an Undo the data model cannot honour is worse than shipping none, so the toast
offers a forward link instead.

### T2 · Start this block — conditional confirm

Two paths, decided by whether the user has another `active` program.

- **No other active:** direct. Refresh, then
  `ProposalActions.successActivated`: **"Volume Cut · Block 3 is your active
  block."** No Undo, same F5 reasoning as T1 — the reverse move is "Leave", and
  it is permanently available in Manage.
- **Another active exists:** the sweep (F3) is about to archive a live block —
  a side effect the lifter did not ask for. It gets the shared activation-sweep
  confirm specified in §06, word for word, because it is word for word the same
  consequence.

### Error states

| Condition | Surface | Copy |
|---|---|---|
| Adopt fails (network/server) | inline `<p>` in destructive ink under the button row — not a dialog; the buttons live there | *"Could not adopt this proposal. Please try again."* (`adoptError`, shipped) |
| Proposal already resolved elsewhere — MCP or a second tab; `adoptProgram` returns `null` | inline, and refresh the page beneath it | *"This proposal is no longer waiting — it was adopted or declined somewhere else."* (`errorResolved`) |
| Adopt succeeded, sweep failed (F4 — two actives) | no error state | the list's "Also active" zone is the surface; it self-heals on the next activate |
| Empty proposal (a coach draft with zero days) | the shipped `ProgramDetail.daysEmpty` — *"No training days yet."* — and both adopt buttons still work | adopting an empty plan is legal and reversible; refusing it would strand the row in `proposed` with no exit but delete |

## 06 · T4 — Activating a draft, and the sweep

The largest gap between what the code does and what any design says. Today: a
bare `outline` "Activate", no confirm, and another program silently disappears
from the home hero.

**Where:** `/programs/[id]` Manage cluster, when `status` is `draft` or
`archived`. Also reached from T2 and from restart (F7).

**Control:** `Activate` — volt on a draft/archived page (that page's one volt
moment).

### 6.1 No other active program — direct, with undo

Activation with nothing to sweep is genuinely cheap and genuinely reversible
(`active → archived` is one write and preserves everything). No dialog.

> `ProgramActions.successActivated`: **Volume Cut · Block 3 is your active
> block.** — *Undo*

Undo calls `setProgramStatusAction(id, 'draft')` and re-renders. Toast dwell 8s
— a lifecycle change earns longer than the logger's set toasts. The undo action
leaves with the toast; the same reversal stays permanently available as "Leave
program" / "Move to drafts".

### 6.2 Another active program exists — confirm, naming the victim

**The confirm must name the program being archived.** That is the entire reason
the dialog exists.

```
┌────────────────────────────────────────────────┐
│  Start Volume Cut · Block 3?                   │
│                                                │
│  Push/Pull/Legs · Block 2 is archived when     │
│  this one starts — you're in week 4 of 6.      │
│  Its workouts, stats and training maxes are    │
│  kept, and you can make it active again from   │
│  Programs.                                     │
│                                                │
│  [ Keep Push/Pull/Legs · Block 2 ]   [ Start ] │
│    safe, initial focus                  volt   │
└────────────────────────────────────────────────┘
```

Exact strings — `ProgramActions.activateDialog.*`:

| Key | English |
|---|---|
| `title` | `Start {name}?` |
| `body` | `{activeName} is archived when this one starts — you're in week {week} of {total}. Its workouts, stats and training maxes are kept, and you can make it active again from Programs.` |
| `bodyUnstarted` | `{activeName} is archived when this one starts. It has no logged sessions yet, and you can make it active again from Programs.` |
| `confirm` | `Start {name}` |
| `pending` | `Starting…` |
| `cancel` | `Keep {activeName}` |

Against §02:

- Both programs are named. Neither is "the other one".
- `bodyUnstarted` exists because "you're in week 1 of 6" on a block with zero
  logged sessions reads as a loss that isn't one.
- The clause is *preservation*, not prohibition. No sentence anywhere says "you
  cannot have two active programs" — the product moves one aside and says
  where it went.
- The cancel button names what you keep, which is why the shared
  `ConfirmDialog.cancel` ("Keep it") is insufficient here.
- `confirmVariant="default"` (volt). This confirm is affirmative, not
  destructive, so the destructive-separation rule does not bite; initial focus
  stays on cancel (shipped behaviour).

### 6.3 The swept program's own page

F4 says the archived sibling gets no event, so its timeline shows a gap: it was
active, now it is archived, and nothing says why. Specify a **derived** status
line — never a fabricated event row:

> `ProgramDetail.statusLine.archivedBySweep`: `Archived when {name} started.`

Rendered only when the program is `archived`, carries no `set_program_status`
event at or after its `updatedAt`, and another program was activated in the same
minute. **If that derivation is not cheap or not certain, omit the line.** A
wrong provenance sentence is worse than a missing one — the standing
provenance-is-a-fact law.

### Error states

| Condition | Copy |
|---|---|
| Activate fails | inline: *"Could not update program status. Please try again."* (`statusError`, shipped) |
| Program is `proposed` — MCP race, `ProposedProgramError` (F5) | inline: *"This program is still a proposal — adopt or decline it first."* (`errorProposed`). States the next move; never "locked" |
| Sweep failed after a successful activate | silent; "Also active" is the surface |

## 07 · T5 — Leaving an active program

**Shipped and substantially correct.** `active → archived` behind a confirm
whose body already preserves: *"Your workouts and stats are kept. You're in week
{week} of {total} — you can reactivate it any time from Programs."*

Two deltas:

| Key | Was | Becomes | Why |
|---|---|---|---|
| `leaveDialog.title` | `Leave this program?` | `Leave {name}?` | §02 rule 1 |
| `leaveDialog.confirm` | `Leave program` | `Leave {name}` | §02 rule 1 |

And: leaving is not destructive, so the confirm takes
`confirmVariant="default"`. It currently inherits `ConfirmDialog`'s destructive
default, which paints a fully reversible archive in delete-red and cheapens the
ink that T3 and T7 actually need.

## 08 · T6 — Un-archiving, and the archived list

Two exits from `archived`; today only one has a surface.

### 8.1 archived → active

Identical to §06 in every respect — same button, same conditional confirm, same
copy. Nothing changes because the source was archived rather than a draft.

### 8.2 archived → draft — the missing edge

`setProgramStatus(id, 'draft')` is a legal, implemented write with no control
anywhere. It is the move for *"I want to rework this old block before running it
again."* Without it, editing an archived block means activating it first — which
fires the sweep and archives your live programme as a side effect of wanting to
edit something.

**Control:** in the Manage cluster on an `archived` detail page:

```
[ Activate ]   [ Move to drafts ]   [ Restart block ]        [ Delete ]
    volt            outline              outline        ghost, destructive, ml-auto
```

Cheap and reversible → **no dialog**, undo toast:

> `ProgramActions.successDrafted`: **Volume Cut · Block 1 moved to drafts.** — *Undo*

Undo calls `setProgramStatusAction(id, 'archived')`.

### 8.3 The archived roll-up

Shipped as a native `<details>` with summary `Archived · {count}` — it **does**
open (native disclosure, no client island needed). Three points:

1. **Absence is the empty state.** The `<details>` renders only when
   `zones.archived.length > 0`. Confirmed as intentional: do **not** add a "No
   archived programs" sentence. Per the de-card contract an empty state is a
   plain sentence *when the section must exist*; this one need not.
2. **Order needs no control.** Rows arrive from `listPrograms` ordered
   `updatedAt desc`, so after a sweep the most recently archived sorts first.
   That is the right order; add no sort UI.
3. **Provenance suffix.** A row archived by a sweep carries the muted meta
   `Programs.row.archivedRecently`: `archived when {name} started` — same
   derivation and the same omit-if-unsure rule as §6.3.

The summary keeps its shipped voice (`text-[11px]` uppercase, tracking-widest,
muted), which already reads as a zone label rather than a control.

## 09 · T3 — Declining a proposal (HARD DELETE)

**The most dangerous unlabelled action in the product.** `declineProgram`
deletes the row (F1); the word "Decline" reads like dismissing a notification.
The surface has one job: make the destruction legible without making the button
so frightening that users leave stale proposals lying around forever.

**Where:** `ProposalActions`, right-anchored via `ml-auto`, `ghost` +
`text-destructive` — never adjacent to the two adopt buttons at equal weight.

**Label:** `Decline` stays. Renaming it "Delete proposal" makes a routine act
read as vandalism; the *dialog* carries the weight instead.

### The confirm

```
┌──────────────────────────────────────────────────┐
│  Decline Volume Cut · Block 3?                   │
│                                                  │
│  Declining deletes the proposal — its 4 training │
│  days and 31 planned sets go with it, and it     │
│  won't appear in Programs again.                 │
│                                                  │
│  Nothing you've logged is touched. Ask your      │
│  coach for a new draft any time.                 │
│                                                  │
│  [ Keep it ]                       [ Decline ]   │
│   safe, initial focus,         destructive ink,  │
│   left-anchored                  right-anchored  │
└──────────────────────────────────────────────────┘
```

Exact strings — `ProposalActions.declineDialog.*`:

| Key | English |
|---|---|
| `title` | `Decline {name}?` |
| `body` | `Declining deletes the proposal — its {days, plural, one {# training day} other {# training days}} and {sets, plural, one {# planned set} other {# planned sets}} go with it, and it won't appear in Programs again.` |
| `bodyKept` | `Nothing you've logged is touched. Ask your coach for a new draft any time.` |
| `confirm` | `Decline` |
| `pending` | `Declining…` |
| cancel | the shared `ConfirmDialog.cancel` — "Keep it" is exactly right here |

Why this beats the shipped *"The proposed plan is deleted. Your coach can always
draft a new one."*:

- It says **deletes** in the first clause, attached to the verb the user
  pressed. "Declining deletes" is the sentence that stops the misread.
- It carries **counts** (§02 rule 5). Day and set counts are already computed
  for the detail page's day list; pass them in.
- It splits consequence and preservation into two paragraphs, so the
  reassurance cannot be skimmed as if it softened the deletion.
- It avoids "cannot be undone" — a phrase so common it has stopped meaning
  anything. "won't appear in Programs again" is concrete.

**Layout:** the footer uses `justify-between` so Keep and Decline sit at
opposite ends. This spatial-separation rule applies to T3 and T7 — the two hard
deletes — only; affirmative confirms may sit adjacent.

### Error states

| Condition | Copy |
|---|---|
| Decline fails | in-dialog, dialog stays open (shipped contract): *"Could not decline this proposal. Please try again."* (`declineError`) |
| Already resolved elsewhere (`declineProgram` → `null`) | in-dialog: *"This proposal is no longer waiting — it was adopted or declined somewhere else."* (`errorResolved`); on acknowledge, close and `router.push('/programs')` |

### What the coach is told: nothing

`list_proposals` is read-only and adopt/decline are owner-only server actions.
After a decline the row simply vanishes from `list_proposals`. **Do not** add a
"your proposal was declined" coach notification — F1 means no durable record
survives to notify from, and inventing one would be a fabricated fact.

## 10 · T7 — Deleting a program (HARD DELETE)

**Where:** Manage cluster, `ghost` + `text-destructive`, `shrink-0`, pushed to
the far right (`ml-auto`). Never on a `proposed` page — that page renders
`ProposalActions`, whose destructive path is Decline.

**Shipped body:** *"Its days and targets go with it. This cannot be undone."* —
true, but it names none of the six things that die (F10) and not the one thing
that survives (F11).

### The confirm

```
┌────────────────────────────────────────────────────┐
│  Delete Volume Cut · Block 2?                      │
│                                                    │
│  This removes 4 training days, 31 planned sets,    │
│  2 week-overrides, its training maxes, and the     │
│  program's whole change history.                   │
│                                                    │
│  Your 27 logged sessions are kept — they'll stay   │
│  in History, no longer tied to this block.         │
│                                                    │
│  [ Keep it ]                          [ Delete ]   │
└────────────────────────────────────────────────────┘
```

Exact strings — `ProgramActions.deleteDialog.*`:

| Key | English |
|---|---|
| `title` | `Delete {name}?` |
| `body` | `This removes {days, plural, one {# training day} other {# training days}}, {sets, plural, one {# planned set} other {# planned sets}}, {overrides, plural, =0 {} one {# week-override, } other {# week-overrides, }}its training maxes, and the program's whole change history.` |
| `bodyWorkouts` | `Your {workouts, plural, one {# logged session} other {# logged sessions}} are kept — they'll stay in History, no longer tied to this block.` |
| `bodyWorkoutsNone` | `You haven't logged a session from this program.` |
| `bodyShared` | `The share link you created stops working.` |
| `bodyProposals` | `{count, plural, one {# pending change from your coach} other {# pending changes from your coach}} goes with it.` |
| `bodyFallback` | `This removes the program's training days, planned sets, training maxes and change history. Your logged sessions are kept in History.` |
| `confirm` | `Delete` |
| `pending` | `Deleting…` |

Composition: `body` always renders; then whichever of
`bodyWorkouts`/`bodyWorkoutsNone` applies; then `bodyShared` only when the
program is shared; then `bodyProposals` only when pending patch proposals exist.
Each is a whole sentence — join them, never assemble one sentence from fragments
(I18N-KEYS §5).

**This needs counts the page must fetch.** Specify one
`programDeletionFacts(userId, id)` read returning
`{ days, sets, overrides, workouts, hasShare, pendingProposals }`, called by the
server component that renders `ProgramActions` and passed down as props. If it
fails, render `bodyFallback` — never block the delete on it, and never print
`0` where a number failed to load.

### Error states

| Condition | Copy |
|---|---|
| Delete fails | in-dialog, stays open: *"Could not delete program. Please try again."* (`deleteError`, shipped) |
| Already gone (`deleteProgram` returns no row) | in-dialog: *"This program is already gone."* (`errorMissing`), then close + `router.push('/programs')` |
| Counts unavailable | `bodyFallback`; the delete stays available |

## 11 · T8 — Restart block

Every mock in the product is named "Block 2" / "Block 3". Only
`restart_program` produces that name (F7, via `nextBlockName`). It ships exactly
one entry point — a button in the detail-page Manage cluster — so the naming
convention the entire design assumes is reachable from one screen, and only if
you already know to look there.

### Where it lives — three entry points, one action

1. **`/programs/[id]` Manage cluster** — shipped (`RestartProgramButton`,
   rendered when `status !== 'draft'`; a draft has nothing to roll over, which
   is right). This is the complete entry: the full confirm with the TM preview.
2. **`/programs/[id]` block-complete banner** — when `blockComplete` is true the
   page already renders a completion eyebrow (`ProgramDetail.blockComplete.*`)
   carrying only a Stats link. **Add the volt "Start the next block" CTA
   there.** Finishing a block is the moment the action is wanted; making the
   lifter scroll to Manage to find it is the gap.
3. **`/programs` active hero** — its block-complete line currently reads
   *"Block complete — restart or review from the program page."*, describing an
   action instead of offering one. Replace with a fact plus a link into the
   detail page's restart. The confirm still lives on the detail page: the list
   must not host lifecycle controls (§04).
   - `Programs.hero.blockComplete`: `Block complete — {weeks, plural, one {# week} other {# weeks}} logged.`
   - `Programs.hero.restartLink`: `Start the next block`

**Not** on the home StatusHero. Home has its own seven-state contract, and a
restart CTA there would compete with Start-workout for the screen's one volt.

### What the confirm says about what carries and what resets

The shipped copy is already good. Deltas, all from §01:

| Key | Was | Becomes | Why |
|---|---|---|---|
| `dialog.title` | `Start the next block?` | `Start {nextName}?` | §02 rule 1 — the name is auto-derived and unchoosable, so the user should see "Volume Cut · Block 3" *before* committing |
| `dialog.body` | `Creates a fresh copy of this program starting at week 1 and makes it active. This one is archived — its history and stats stay.` | `{nextName} starts at week 1 with the same days, exercises and sets. {name} is archived — its workouts, stats and history stay.` | names both sides; "fresh copy" undersells that overrides, supersets and muscle tags come too |
| `dialog.bodyIncrements` | as shipped | keep verbatim | already states the TM carry-forward (F8) |
| `dialog.bodyStalled` / `dialog.bodyStalledReset` | as shipped | keep verbatim | already state the stalled-lift skip (F8) |
| — | — | **new** `dialog.bodyResets`: `Week 1 starts clean — the new block has no logged sessions and no banked progress.` | F8's `bankedWaves: 0` reset is invisible today; a lifter mid-wave deserves to know the bank empties |
| — | — | **new** `dialog.bodyNotCarried`: `Your diet phase and any share link stay with {name} — set them again on the new block if you want them.` | F9; renders only when `dietPhase !== null` or the source is shared |

Carries vs. resets, as the copy must convey:

| Carries forward | Resets, or stays behind |
|---|---|
| Days, exercises, supersets, custom-exercise sources, progression | Week counter → week 1 |
| Sets, techniques, per-set rest, per-week overrides | Banked waves → 0 |
| Muscle tags | Logged workouts and stats (stay on the source) |
| Training maxes, stepped up one increment for clean lifts | Diet phase (does not travel) |
| Autoreg flag, stall policy, deload policy, overshoot policy | Share visibility (the clone is private) |
| Notes, description, icon, hero image, source URL | Author attribution (the clone is owner-authored) |
| Weekday schedule | Stalled lifts' TM (held, not stepped) |

**Confirm variant:** `default` (volt) — restart is affirmative. Shipped.

### Error states

| Condition | Copy |
|---|---|
| Restart fails | in-dialog: *"Could not restart this block. Please try again."* (`restartError`, shipped) |
| TM preview fails to load | **no error.** The dialog renders `dialog.body` alone, exactly as while loading (`restartDialogBody(null)`, shipped). The restart never waits on the preview |
| Clone succeeded, activate failed (F7's two-step) | the clone exists as a draft. Inline after refresh: *"{nextName} is saved as a draft — activate it when you're ready."* (`errorActivateFailed`). Never silent, never an auto-retry |
| Source is `proposed` (F12) | unreachable by construction — a proposal page shows `ProposalActions`, which has no restart. Not a surface |

## 12 · T9 — Proposed programs refuse lifecycle writes

F5 and F6. The design obligation is negative: **do not draw archive, activate,
edit, restart, delete, or share on a `proposed` row or page.**

How that is guaranteed:

- **List:** rows are `<Link>`s with no controls (§04). Structural.
- **Detail:** `status === 'proposed'` renders `ProposalActions` *instead of*
  `ProgramActions`, not alongside. Structural.
- **Day cards:** a proposal's day cards must render no Start control — F6 means
  instantiation throws. The plan renders read-only under the proposal lede,
  which already explains why: *"Nothing trains until you confirm."* That
  sentence is the whole unavailable-state explanation, and it is phrased as a
  condition, not a prohibition. Keep it verbatim.

**The one error state that can surface:** an MCP client or a second tab moves
the program while the page is open, so an owner action hits
`ProposedProgramError`. Every catch site renders one inline sentence rather than
a raw error:

> `ProgramActions.errorProposed`: *"This program is still a proposal — adopt or decline it first."*

It names the next move. It never says locked, disabled, blocked, or not allowed.

## 13 · i18n keys

Additions and changed values only; unlisted shipped keys stay as they are.
Namespaces match the component that owns the string (I18N-KEYS §7.1).

```jsonc
{
  "ProgramActions": {
    "draftAction": "Move to drafts",
    "activateDialog": {
      "title": "Start {name}?",
      "body": "{activeName} is archived when this one starts — you're in week {week} of {total}. Its workouts, stats and training maxes are kept, and you can make it active again from Programs.",
      "bodyUnstarted": "{activeName} is archived when this one starts. It has no logged sessions yet, and you can make it active again from Programs.",
      "confirm": "Start {name}",
      "pending": "Starting…",
      "cancel": "Keep {activeName}"
    },
    "leaveDialog": {
      "title": "Leave {name}?",
      "confirm": "Leave {name}"
    },
    "deleteDialog": {
      "title": "Delete {name}?",
      "body": "This removes {days, plural, one {# training day} other {# training days}}, {sets, plural, one {# planned set} other {# planned sets}}, {overrides, plural, =0 {} one {# week-override, } other {# week-overrides, }}its training maxes, and the program's whole change history.",
      "bodyWorkouts": "Your {workouts, plural, one {# logged session} other {# logged sessions}} are kept — they'll stay in History, no longer tied to this block.",
      "bodyWorkoutsNone": "You haven't logged a session from this program.",
      "bodyShared": "The share link you created stops working.",
      "bodyProposals": "{count, plural, one {# pending change from your coach} other {# pending changes from your coach}} goes with it.",
      "bodyFallback": "This removes the program's training days, planned sets, training maxes and change history. Your logged sessions are kept in History."
    },
    "successActivated": "{name} is your active block.",
    "successDrafted": "{name} moved to drafts.",
    "undo": "Undo",
    "errorProposed": "This program is still a proposal — adopt or decline it first.",
    "errorMissing": "This program is already gone."
  },

  "ProposalActions": {
    "adoptActivateAction": "Start this block",
    "adoptDraftAction": "Save as draft",
    "declineDialog": {
      "title": "Decline {name}?",
      "body": "Declining deletes the proposal — its {days, plural, one {# training day} other {# training days}} and {sets, plural, one {# planned set} other {# planned sets}} go with it, and it won't appear in Programs again.",
      "bodyKept": "Nothing you've logged is touched. Ask your coach for a new draft any time."
    },
    "successDrafted": "{name} is in your drafts.",
    "successActivated": "{name} is your active block.",
    "draftsLink": "Open drafts",
    "errorResolved": "This proposal is no longer waiting — it was adopted or declined somewhere else."
  },

  "RestartProgramButton": {
    "dialog": {
      "title": "Start {nextName}?",
      "body": "{nextName} starts at week 1 with the same days, exercises and sets. {name} is archived — its workouts, stats and history stay.",
      "bodyResets": "Week 1 starts clean — the new block has no logged sessions and no banked progress.",
      "bodyNotCarried": "Your diet phase and any share link stay with {name} — set them again on the new block if you want them."
    },
    "errorActivateFailed": "{nextName} is saved as a draft — activate it when you're ready."
  },

  "ProgramDetail": {
    "blockComplete": {
      "restartAction": "Start the next block"
    },
    "statusLine": {
      "archivedBySweep": "Archived when {name} started."
    }
  },

  "Programs": {
    "hero": {
      "blockComplete": "Block complete — {weeks, plural, one {# week} other {# weeks}} logged.",
      "restartLink": "Start the next block"
    },
    "row": {
      "archivedRecently": "archived when {name} started"
    }
  }
}
```

Naming notes: every leaf names its slot, not its sentence — `bodyWorkouts` is
*the body paragraph about workouts* and survives a rewrite; no argument appears
in a key; plurals live inside the ICU value; `successX` / `errorX` follow the
catalog's existing families.

**Renamed keys: none.** `ProgramActions.deleteDialog.body`,
`ProposalActions.declineDialog.body`, `RestartProgramButton.dialog.body` and the
two dialog titles are **rewritten in place** — same keys, new values — because a
rename orphans translations for no gain (I18N-KEYS §0).

## 14 · Component deltas required

No new components. Three small changes to existing ones:

1. `ConfirmDialog` — optional `cancelLabel?: string`, defaulting to the shared
   `ConfirmDialog.cancel`; footer becomes `justify-between` so a destructive
   confirm and the safe cancel sit at opposite ends. Initial focus already lands
   on cancel; keep it.
2. `ConfirmDialog` — `body` accepts `string | string[]`, rendering one `<p>` per
   entry. `restartDialogBody` already returns a descriptor list the caller joins
   by hand; T3, T7 and T8 all need multi-paragraph bodies where the paragraph
   break is load-bearing.
3. A toast host for lifecycle successes. Reuse `SessionToast`'s drain semantics
   rather than adding a second toast system.

Stories: `confirm-dialog.stories.tsx` gains the sweep confirm, the decline
confirm and the delete confirm as named states — DESIGN.md requires a
component's real states, and these three *are* the states this direction is
about.

## 15 · Deliberately not built

- **A soft delete or trash for declined proposals.** F1 is the shipped decision
  (the PRD's open question, resolved hard-delete-v1). The surface makes the
  deletion legible instead of pretending it is reversible.
- **Undo on adopt.** F5 makes `proposed` unreachable once left; an Undo the data
  model cannot honour is worse than none.
- **A "two active programs" management screen.** F4's anomaly is transient and
  self-heals on the next activate; the "Also active" zone is the whole surface.
- **Lifecycle controls on list rows.** The structural guarantee behind §12.
- **A coach notification on decline.** Nothing durable survives to notify from.
- **Renaming the restart clone before it is created.** `nextBlockName` owns the
  name, the confirm shows it, and the clone is renameable afterwards in the
  builder like any other program.
- **An "unarchive to proposed" path.** Not an edge the code has, or should.
