# Trained history in the editor

How a mid-block program editor says "you already did this" without lying about locks, dimming its own best content, or claiming a week is one thing when it is several.

- Status: design decision / pending implementation
- Date: 2026-08-22
- Depends on: the program editor surfaces (`/programs/new`, `/programs/[id]/edit`)

## 01 · The problem, and the correction

The editor loads `getProgramDetail` — the raw template tree — and calls neither
`programWeekState` nor `resolveDayState`. It is **trained-state blind**. You can
open a program you are three weeks into, change week 2, and see nothing telling
you the change will not reach what you already lifted.

The obvious fix is a week strip marking trained weeks. **That fix is wrong**, and
the reason is the heart of this spec.

### The freeze unit is a workout instantiation, not a week

`instantiateProgramDay` (`src/db/prescriptions.ts:514-682`) derives a
prescription and writes `prescribedLoadKg` / `prescribedRepMin` / `prescribedRir`
/ `prescribedRpe` into that workout's set rows, under a comment reading *"no edit
path may ever update these"* (`prescriptions.ts:657-659`). That happens once per
**(program day × week)** — one transaction, one day, one week. There is no
week-wide snapshot event anywhere in the codebase.

So in a part-done week, some days are frozen and some are not:

| Week 3 | State | Does today's edit reach it? |
|---|---|---|
| Day 1 | completed | no — frozen at its own instantiation |
| Day 2 | in progress | **no** — also frozen; there is no re-sync path |
| Day 3 | not started | **yes** — derives fresh when started |
| Day 4 | not started | **yes** |

A week-level indicator would be correct about half of week 3 and wrong about the
other half. The encoding has to live on the **day row**.

The in-progress case deserves its own emphasis, because the intuition runs
exactly backwards: a session you have started but not finished is *as frozen as*
a finished one. Its sets were inserted at start time, and resuming returns the
existing row untouched (`prescriptions.ts:550-565`).

## 02 · Decisions

### D1 — The past is SETTLED, not LOCKED. Never say "locked."

`setProgramSetOverride` and `updateProgramSet` have **zero** trained-week
awareness. The write always succeeds. It is simply *inert* for an
already-instantiated day.

A lock icon or "this week is locked" would claim an enforcement that does not
exist, which this repo forbids — a surface never describes behaviour that is not
implemented. It is also a known production failure: Smartsheet users report lock
badges on rows that stay editable through another path. **A lock affordance that
lies is worse than no affordance.**

Say what is true instead: the edit lands on the plan, and the plan is not what
you already lifted.

### D2 — Trained sessions render as LOG, not as a disabled FORM.

`disabled` is wrong on three counts. It drops content out of the tab order; it
invites WCAG 1.4.3's inactive-component contrast exemption, which would make this
content *technically conformant and unreadable*; and it means "do something and
this becomes available," which is false — nothing the user can do makes week 2
editable again.

Carbon's own test settles it: where content "is still relevant to the user or
important to task completion," use read-only rather than disabled. A trained
week's actual loads are the most valuable thing on the screen.

So go past read-only: **render them as a log**. Values as text. No field borders,
no input chrome, no placeholder. A field that looks like a field and rejects
typing is a broken promise; a value that never looked like a field promises
nothing. This also keeps trained history at **full contrast**, because it is the
content people most want to read.

### D3 — Encode the boundary with a labelled seam, never with dimness.

WCAG 1.4.1 requires a non-colour channel, and lightness alone under 3:1 is not a
distinction. Dimming is the obvious encoding and the wrong one — the same mistake
this codebase already made twice with blanket `opacity-50` on disabled rows
(`choice-list.tsx`, `switch-row.tsx`, both since fixed).

Three redundant channels, none of them dimness:

1. **A rule at the seam**, labelled in words — the "now" divider between the last
   settled row and the first editable one. The one encoding every reader already
   knows, from every timeline they have seen.
2. **A change in FORM** — log rendering versus input rendering. Structural, not
   stylistic.
3. **A word on each settled row** — the shipped vocabulary (§03), not a new one.

### D4 — State scope BEFORE the edit, not at save.

A persistent, non-modal line at the top of the surface naming where editing
begins. Not a dialog: editing a program is a *frequent* action, and NN/g's
finding is that frequent confirmations are habituated away within days — "if you
cry wolf too many times, people will stop paying attention."

This is the inversion the calendar world reached independently: choose the scope
first, then edit, rather than interrogating on the way out.

### D5 — A mixed week reports a COUNT. Never a tri-state control.

"Week 3 · 2 of 4 sessions trained." Not an indeterminate checkbox.

Mixed is a state a user can leave but never enter; its entire semantic is "toggle
my children," which is precisely the operation that must be forbidden here; and
NN/g has never published evidence that anyone reads the dash correctly. A count
survives translation, screen readers and colour blindness.

The week header *reports*; the day rows *carry* the state. Which matches §01: the
week is not the unit.

### D6 — Copy is in domain terms, never system terms.

Accounting software has the most mature version of this, and its discipline is
that a lock is always explained by what it protects, never by how it works.

> **Say:** "You trained this. Editing the plan won't change what you lifted."
> **Never:** "This week is locked." · "Prescriptions are snapshotted." ·
> "This set is immutable."

### D7 — Allow the inert edit, explain it ambiently, do not block it.

Four options: block, allow silently, confirm, allow-and-explain.

**Silent allow is the worst** — an accepted edit that does nothing is a false
success signal, and the user learns the truth weeks later or never. **Blocking is
wrong** because nothing is actually blocked (D1). **A dialog** habituates.

So: allow, and make warning unnecessary — the surface should have said where the
boundary is before the user touched anything (D4). The ideal number of
inert-edit warnings is zero, reached by never letting a user arrive at one blind.

### D8 — Forward-only is the correct behaviour, not an apology.

Worth recording because it changes the tone of every string on this surface.
RFC 5545 defines recurrence edit scope, and `RANGE=THISANDPRIOR` — "this instance
and all earlier ones" — is **deprecated with a normative MUST NOT**. The
calendaring standard tried editing the past and banned generating it. Its default
`RANGE`, when absent, is the *single* instance: the narrowest scope, not the
broadest.

Our snapshot-forward-only engine landed where the standards body landed. The copy
should say what editing *does* reach, in a matter-of-fact voice, rather than
hedging about what it cannot.

## 03 · Vocabulary — reuse, do not invent

The app already has words for all of this. The editor introduces a first, not a
second, so it must borrow:

| Existing copy | Key |
|---|---|
| "Done" | `ProgramDetail.day.doneBadge` |
| "In progress" | `ProgramDetail.day.inProgressBadge` |
| "Skipped" | `ProgramDetail.day.skippedBadge` — **past weeks only** |
| "week trained" | `ProgramDetail.statusLine.weekTrained` |
| "Block complete." | `ProgramDetail.statusLine.complete` |
| "{done} of {total} done" | `Programs.thisWeek.doneCount` |

`resolveDayState` (`week-view.ts:39-54`) and `programStatusLine`
(`detail-view.ts:44`) are the canonical decision points. The editor calls them —
it does not re-derive, for the reason `list-view.ts:96-99` already gives about the
home hero: two derivations eventually disagree.

**"Skipped" is gated.** The app says it only for an untouched day in a *past*
week. The editor must not say it for a current or future week.

## 04 · The edge cases, and what each must not get wrong

| Case | Truth | The naive mistake |
|---|---|---|
| Draft, never started | No workouts exist at all | Showing trained-state UI computed from nothing |
| Week 1, part done | Some days already frozen | "It's early, so it's all editable" |
| **Split week** | Per-day: logged frozen, unstarted live | Treating the week as one unit — the central error |
| Day in progress | **Frozen**, like a completed one | "It hasn't finished, so my edit applies" |
| Deload week | Deload-ness is *derive-time* only | Thinking deload weeks freeze differently — they don't |
| Final week, part done | Not `blockComplete` | Conflating "last week" with "complete" |
| Block complete | Program stays `active`; the final week is re-runnable, and a re-run is a FRESH instantiation that WILL pick up edits | "Complete means read-only" |
| Archived | **Editing is unguarded** — no status check anywhere | Claiming archived is read-only |
| Mid-restart | `restartProgramAction` is two calls, not one transaction; a failure leaves an orphan draft | Assuming restart is atomic |
| `mesocycleWeeks` shrunk below trained weeks | Trained weeks can sit ABOVE the bound | Iterating `1..mesocycleWeeks` and silently dropping real history |

That last row deserves explicit design. We shipped the shrink report
(`trainedWeeksBeyond`) today and nothing renders it. A week list that loops to
`mesocycleWeeks` will hide weeks the user actually trained.

Two rows are **gaps in the code, not in the design**: archived programs are
editable with nothing preventing it, and restart is non-atomic. Neither is this
spec's to fix, and neither may be described as solved.

## 05 · What a surface may and may not say

**May say**
- "Done" / "In progress" for a day, from `resolveDayState`.
- "Week N trained" only when every day of N has a completed workout carrying at
  least one completed set — the predicate `programWeekState` uses, tightened
  after the cooked-block incident (`programs.ts:1064-1069`).
- "Editing changes future sessions, not what you've already logged."
- "Week 3 · 2 of 4 sessions trained."

**May not say**
- "This week is locked" / "You can't edit a trained week" — no enforcement exists.
- "Archived programs are read-only" — not true.
- "In-progress sessions will pick up your changes" — false.
- Anything treating `mesocycleWeeks` as the outer bound of trained history.
- "Skipped" outside a past week.

## 06 · Prior art, and where it runs out

Most training apps dodge this problem rather than solve it. Two do publish a
rule, and both are worth knowing.

**Everfit states our predicate almost verbatim.** Its Live Sync propagates to
"workouts today and onwards **that have not yet been logged**" — per-workout,
gated on logged state, not per-week. Its bulk week-removal exempts executed work
the same way: workouts "logged or in progress" stay on the calendar. That is
independent confirmation that §01's per-instantiation boundary is the right unit,
arrived at by someone else's engine.

**Physitrack makes the blast radius an explicit choice** — "This day only",
"From this day on", "All days". The third permits retroactive edits, which we
will not do (D8). But the first two are worth remembering if per-week overrides
ever get a scope picker: it is the same shape as RFC 5545's `RANGE`, offered up
front rather than at save.

**TrainHeroic has the only documented past-vs-plan vocabulary**: green for done
as prescribed, yellow for athlete-modified, red for missed, and — the useful part
— the **changed prescription struck through with the actual value beneath it**.
That is a concrete encoding for D2's log rendering: a settled row can show both
what was planned and what was lifted, without either pretending to be a field.

**Strong splits structure from values.** Changing the shape of a session
(reordering, adding/removing) prompts; changing reps or weight saves silently.
Two different risks, two different frictions — worth considering before treating
every edit the same.

**Nobody blocks.** Across every app with published documentation, completed work
is protected by *exclusion from propagation*, never by a modal saying "this
session is already done." No prior art was found for a blocking dialog. That
supports D7.

**And nobody does the thing this spec is for.** No app documents visually
distinguishing trained from untrained weeks *inside an editing surface*. There is
no convention to match here, which means the encoding in D3 is a design to
validate with real use, not a pattern to copy. Worth stating plainly rather than
implying the research settled it.

## 07 · Open question for the owner

**One surface or two?** GitHub separates a workflow definition from its runs, and
re-running specific jobs deliberately uses the workflow from the original commit
while a full re-run adopts the current one. TrueCoach separates the program from
the client's calendar and gates propagation behind an explicit Sync toggle.

Both suggest a trained session and an untrained one are different kinds of object
that may belong on different screens. This spec assumes ONE surface with a seam,
because that is what the artboards draw and what the editor already is — but it
is the more expensive design and the one likelier to mislead. Worth deciding
deliberately rather than by default.
