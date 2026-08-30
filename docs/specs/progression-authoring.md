# Progression Authoring

The authoring surfaces for the training max and the two TM-bearing progression
schemes — `percent-1rm` and `amrap-cycle` — plus the full seven-scheme picker
they hang off. Today both schemes are selectable in principle and unfillable in
practice: there is no UI that can write `weekPercents[]`, a `wave[][]` matrix,
`waveReps[][]`, a `deloadRow`, or `tmBumpTiming`, and the one TM field that
exists rides the full-replace save instead of the sanctioned setter. Two of
seven schemes are dead ends.

- Status: draft / codebase-verified / no implementation
- Date: 2026-08-22

## 01 · What exists, and what is broken about it

| Fact | Where | Consequence |
|---|---|---|
| `progression` is a 7-arm discriminated union | `src/lib/programs/program-input.ts:169` | 7 schemes are storable; 2 are unauthorable |
| `setTrainingMax` is "THE single call site for every training-max change" | `src/db/program-patches.ts:496` | …except the builder, which does not use it |
| The builder's TM field writes `progression.trainingMaxKg` through the draft | `src/app/programs/new/program-builder.tsx:660`, `program-draft.ts:642` (`withDraftTrainingMax`) | A TM edit in the UI produces **no `adjust_training_max` event and no reason** — the change log has a hole exactly where the audited setter promised it wouldn't |
| `TmResetButton` is the only UI that calls the setter | `src/app/programs/[id]/tm-reset-button.tsx` → `adjustTrainingMaxAction` | Reason `'reset'` only; hardcoded, not chosen |
| `SchemeCopy` owns the name + one-liner for all 7 schemes | `src/lib/programs/scheme-copy.ts`, `messages/en.json:1822` | The picker's copy already exists and must be reused, not re-written |
| `SchemeSubtitle` says "The builder has no scheme picker" | `src/app/programs/new/scheme-subtitle.tsx:7` | Scheme choice is agent-only today |
| The editor is the phone column (`max-w-md`) | `src/app/programs/[id]/edit/page.tsx:76` | A 12×20 matrix has nowhere to live |

**Position.** This spec adds three things and removes one. It adds (a) a TM
surface that always routes through `setTrainingMax` with an honestly-captured
reason, (b) parameter editors for `percent-1rm` and `amrap-cycle` in both a
phone and a desktop form, (c) a flat seven-scheme picker. It removes the
builder's silent full-replace TM write.

## 02 · The engine semantics the UI must not lie about

Everything below is read out of `src/lib/programs/progression.ts` and
`src/db/prescriptions.ts`. Each row is a sentence the surface owes the user,
because getting it wrong makes the preview disagree with the prescription.

| Rule | Code | Copy obligation |
|---|---|---|
| `percent-1rm` indexes `weekPercents[min(week, len) - 1]` — it **clamps**, it does not repeat | `progression.ts:255` | Fewer percents than weeks ⇒ "weeks {n}+ hold at {last}%". More percents than weeks ⇒ the tail is unreachable, say so |
| `percent-1rm` indexes the **raw week number**, including the deload week | `progression.ts:255` | The week list is 1..N of the block, deload week included and marked |
| `amrap-cycle` indexes `wave[steps % wave.length]` where `steps` = completed **non-deload** weeks | `progression.ts:373` | The wave **repeats**; the deload week is skipped on the wave axis. Never label wave rows "Week 1..3" — label them "Wave week 1..3" |
| A wave row shorter than the day's set count clamps to its last percent | `progression.ts:376` | A 3-cell row over 5 sets is legal, not an error; show the implied tail |
| A `waveReps` cell sets `repMin` and **nulls `repMax`** | `progression.ts:386` | Prescribing wave reps replaces the set's rep *range* with a fixed number |
| `deloadRow` emits only when the resolved deload policy is `'scheduled'` **and** the chassis is `reps_weight` | `progression.ts:571`, `:579` | A deload row on a `'none'`/`'reactive'` program is inert — say it, don't hide the field |
| `bankedWaves` counts waves already folded into the stored TM by the wave-boundary persist | `prescriptions.ts:577`, `program-input.ts:217` | Read-only in every UI. It is engine bookkeeping, not a setting |
| `incrementKg: 0` never banks | `prescriptions.ts` (wave-boundary persist) | Static-wave configs get no TM history; don't promise one |

## 03 · `tmBumpTiming` is a stamped fact — the safety contract

### The mechanism, confirmed

1. On a **stored** row, an absent `tmBumpTiming` means `'before-deload'` — the
   legacy engine behavior. Both readers apply that fallback explicitly:
   `usesOldTmOnDeload` (`progression.ts:334`) and `amrapBankableWaves`
   (`progression.ts:316`) each read `?? 'before-deload'`.
2. Migration `0037_kind_silver_surfer.sql` stamped `"tmBumpTiming":"before-deload"`
   onto **every** pre-existing `amrap-cycle` row. The absent case is preserved
   only for rows the migration could not have seen.
3. `progressionSchema` deliberately uses a **transform, not `.default()`**
   (`program-input.ts:287`), so the type keeps the field optional while every
   parse path materializes `'after-deload'` onto a config that arrives without
   it. The comment says why: the absent-field fallback must stay expressible.
4. Therefore **any parse of an amrap-cycle object that omits the field stamps
   `'after-deload'`.** That includes `parseProgression` inside
   `setTrainingMax` (`program-patches.ts:536`) and every full-replace save
   through `parseProgramInput`.

### The failure this creates, stated plainly

A UI that renders `tmBumpTiming` as a segmented control with a preselected
option, or that constructs an `amrap-cycle` object from form fields and lets
the transform fill the gap, will **silently rewrite which training max an
existing program's deload week derives off**. The loads move. The change log
records nothing, because `tmBumpTiming` is not part of any event payload. A
lifter mid-block gets different deload weights and no explanation.

### The four rules the surface must obey

**R1 — No default at creation.** The `tmBumpTiming` control ships with **no
option selected**. It is a required field: the exercise cannot be saved with an
`amrap-cycle` progression until the author picks one. There is no "recommended"
preselection and no auto-advance; the two options are presented as equals with
their consequences spelled out. The zod transform stays exactly as it is — it
is the *storage* backstop for agent writes, and the UI must never be the thing
that relies on it.

**R2 — The editor never posts the field on an existing config.** The stored
value is displayed, and the full-replace payload carries the *stored object
verbatim* (the existing pass-through discipline in `detailToProgramDraft`).
The editor's form state holds no `tmBumpTiming` at all for an already-saved
exercise, so there is no value that could be posted wrong.

**R3 — Changing it is its own act, with its own setter and its own event.**
Add `setTmBumpTiming(userId, programId, dayPosition, exercisePosition, timing,
actor)` beside `setTrainingMax` in `src/db/program-patches.ts`, with
`action: 'set_tm_bump_timing'` and `payload: {before, after}`, plus a
`set_tm_bump_timing` MCP patch tool. In the UI it is a `ConfirmDialog` —
the `TmResetButton` idiom — that names the consequence with the actual week
number and the two actual training maxes before it writes. It is never folded
into a Save button.

**R4 — Provenance is visible.** A row whose value came from migration 0037
reads as inherited, not chosen. The dialog and the read row both carry a note
distinguishing "this program was written before the setting existed and kept
its original behaviour" from "you chose this". Absent the field entirely (a row
the migration missed), the surface shows `'before-deload'` **as the effective
value with an explicit legacy note** and offers the dialog to make it explicit —
it never writes on read.

Consequence copy, verbatim, both directions:

- before → after: "Week {deloadWeek} will use the training max from *before*
  this wave's bump — {oldTm} {unit} instead of {newTm} {unit}. Weeks after the
  deload are unchanged."
- after → before: "Week {deloadWeek} will use the training max from *after*
  this wave's bump — {newTm} {unit} instead of {oldTm} {unit}. Weeks after the
  deload are unchanged."

If the program's resolved deload policy is not `'scheduled'`, or `deloadWeek`
is null, the control renders **disabled with an explanatory hint** — the
setting has no effect on this program today — and still shows the stored value.
It is not hidden: hiding it is how a config gets edited blind later.

### Test anchors this contract owes

- A full-replace save of an existing `'before-deload'` program, made from the
  editor with no timing interaction, reads back `'before-deload'`.
- `setTrainingMax` on a row with the field absent does not stamp
  `'after-deload'` (this is a **latent bug today** — `parseProgression` will
  stamp it; the fix is to preserve an absent field across the setter's merge,
  or to backfill defensively in the same migration lane as 0037).
- Creating an `amrap-cycle` exercise with no timing choice fails validation at
  the form, before any parse.

## 04 · The training-max surface

### Where a TM lives

TMs are **per exercise slot**, stored inside `program_exercises.progression`,
and they carry across blocks: `cloneProgram`'s restart writes them forward with
reason `'block-restart'` (`prescriptions.ts:79`). So the TM has two homes and
they show different things:

1. **The exercise row, inside the program editor** — the current number, inline
   editable, because that is where an author sets it while building.
2. **A TM detail sheet, opened from that row** — the number's *history*: every
   `adjust_training_max` event for this slot, newest first, each line carrying
   its reason. This is the only place a lifter can answer "why is my squat TM
   145 now?" The events already exist; nothing new is stored.

The program detail page keeps `TmResetButton` where it is (it is a response to
an M4 proposal, not general authoring) but its dialog gains the same history
link.

### Reason is captured by which control was pressed, never by a dropdown

`TrainingMaxReason` has four values (`program-patches.ts:475`). Two of them are
**engine facts** and must never be offered to a human: `'cycle-end'` belongs to
the wave-boundary persist, `'block-restart'` to `cloneProgram`. Offering them
would let a UI write a lie into the audit trail.

The surface therefore offers exactly two acts, as two distinct controls, so the
reason falls out of the gesture and there is nothing to default:

| Gesture | Reason written | Copy |
|---|---|---|
| Editing the inline TM number, then confirming | `'manual'` | "Update training max" |
| The "Back it down" control (the existing `TmResetButton` shape) | `'reset'` | "Back this training max down" — subtitle: "Use this after repeated misses. It's logged as a reset, not a routine change." |

The inline field does **not** save on blur. Blur stages the value; a `Save`
button in the row commits it through `adjustTrainingMaxAction` (extended to
take a reason). Staged-but-uncommitted state is a volt-free "unsaved" hairline
treatment; navigating away discards. This is the change that removes the silent
full-replace write: **`withDraftTrainingMax` is deleted from the draft path**
and `trainingMax`/`trainingMaxFromE1rm` stay in the draft only as *display*
seeds.

The e1RM prefill keeps working exactly as it does now (`seedTrainingMax`,
`program-draft.ts:757`): a `trainingMaxKg === 0` sketch shows `e1RM × 0.85`
with the existing "from your estimated max" caption, and that prefill is a
**suggestion in an unsaved field** — it is not written until the author
commits it, at which point it is a `'manual'` change like any other.

### States

| State | Treatment |
|---|---|
| Sketch, no history | Empty field, placeholder, hint: "No history for this lift yet — enter the weight you'd base percentages on." |
| Sketch, history exists | Prefilled from e1RM × 0.85, caption until first edit (existing behaviour) |
| Set | The number, `tnum`, plus a muted "changed {relativeTime}" |
| Staged | Number differs from stored: row shows `Save` / `Discard`, no volt on either (the volt is the page's primary action) |
| Pending | Field disabled, `Ghost` in the trailing slot, existing 150ms delay rule |
| Error | Inline message under the row, retry in place (the `TmResetButton` error idiom) |
| Read-only | `proposed` programs and shared read-only views render the number as words, no field, no controls |

## 05 · `percent-1rm` parameters

Two fields: `trainingMaxKg` (§04) and `weekPercents[]` — 1 to 52 floats,
`0..2`.

### Phone (the 448px column)

The week list is a `DividerList`, one `DividerRow` per entry, indexed to the
block's week axis:

```
PERCENT BY WEEK                              (Section caps header)
─────────────────────────────────────────────
Week 1                        85%          ›
Week 2                        90%          ›
Week 3                        95%          ›
Week 4  · deload              60%          ›
─────────────────────────────────────────────
Weeks 5+ hold at 95%                          (hint, muted)
+ Add week
```

- The trailing value is a percent, right-aligned, `tnum`. Tapping the row opens
  a compact numeric sheet with a stepper (±2.5 pp) and a keyboard field —
  never a raw text input in a list row; the sheet is the keep-list overlay.
- The deload week is **labelled** on its row (it is a real index into
  `weekPercents`; §02) and is not otherwise special.
- The tail hint states the clamp rule in the user's own numbers. When
  `weekPercents.length > mesocycleWeeks`, the surplus rows render in the
  dashed/quarantined `DividerList` variant with the hint "Weeks {n}+ are past
  the end of this block and never run."
- `+ Add week` appends a copy of the last percent. Remove is in the row sheet,
  not a swipe.
- **Presets** sit above the list as a control cluster (chips are controls):
  "Ascending 75/85/95", "Wendler 65/75/85", "Flat" — each writes a whole array
  and is announced as replacing the current one.

### Desktop (≥840px)

The list becomes a single horizontal strip using the builder's existing
column-header vocabulary (`program-builder.tsx:690` — the
`text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground`
header strip over `flex` rows): weeks as columns, one row of percent inputs,
`tnum`, with the deload column marked by its header. Tab moves along weeks.
Nothing new is invented; it is the set-row grid rotated.

## 06 · `amrap-cycle` parameters

Six authorable fields plus one read-only: `trainingMaxKg` (§04), `incrementKg`,
`wave[weekIdx][setIdx]` (≤12 × ≤20), `waveReps[][]` (same shape, optional),
`deloadRow` (`percents[]` ≤20 + `reps`), `tmBumpTiming` (§03), and
`bankedWaves` (read-only).

### Phone: per-week rows, never a matrix

A 12×20 matrix cannot exist in a 448px column, and shrinking it produces
unreadable cells. The phone edits **one wave week at a time**.

```
WAVE                                         (Section caps header)
─────────────────────────────────────────────
Wave week 1        65% · 75% · 85%+     5/5/5 ›
Wave week 2        70% · 80% · 90%+     3/3/3 ›
Wave week 3        75% · 85% · 95%+     5/3/1 ›
─────────────────────────────────────────────
Repeats every 3 weeks. Deload weeks don't advance it.
+ Add wave week

DELOAD ROW
─────────────────────────────────────────────
40% · 50% · 60%, 5 reps                     ›
─────────────────────────────────────────────
Runs only on a scheduled deload.              (hint when policy ≠ scheduled)

TRAINING MAX BUMP
─────────────────────────────────────────────
+2.5 kg per completed wave                  ›
Deload uses the max from before the bump     ›
─────────────────────────────────────────────
3 waves banked into 147.5 kg                  (read-only, muted)
```

Each `Wave week N` row summarises its percents (interpuncted, the last one
carrying a `+` when it is the AMRAP set) and its reps, and opens a **full-height
week sheet**:

```
Wave week 2                          ✕
─────────────────────────────────────
Set 1        70%          3 reps
Set 2        80%          3 reps
Set 3        90%          3 reps  ← AMRAP
─────────────────────────────────────
+ Add set          Remove this week
Reps prescribed here replace the set's rep range.
```

- The sheet is a vertical `DividerList` of sets — the same shape the logger
  already uses for sets, so there is no new mental model.
- Percent and reps are two fields on one row, sharing the builder's
  `flex-1`/`flex-[1.4]` cell rhythm.
- The reps column is **off by default** (`waveReps` absent). A single toggle
  chip at the top of the sheet, "Prescribe reps", turns it on for the *whole*
  wave — `waveReps.length` must equal `wave.length`
  (`program-input.ts:273`), so it can never be a per-row switch. Turning it on
  seeds every row from the template's `repMin`; turning it off clears
  `waveReps` entirely, with a confirm.
- Rows shorter than the day's set count show the implied tail as a muted ghost
  cell reading the clamped percent — the §02 clamp rule made visible rather
  than explained.
- **Presets**, as chips above the list: "5/3/1", "5s PRO", "Static". Each writes
  `wave`, `waveReps` and `deloadRow` together and says so.

### Desktop (≥840px): the real matrix

Above 840px the editor becomes two panes and the wave becomes a grid — the same
column-header strip and `divide-y divide-border/60` rows as the builder's set
table, with weeks as rows and sets as columns:

```
          SET 1      SET 2      SET 3      SET 4
Week 1   65 | 5     75 | 5     85 | 5+      —
Week 2   70 | 3     80 | 3     90 | 3+      —
Week 3   75 | 5     85 | 3     95 | 1+      —
Deload   40 | 5     50 | 5     60 | 5
```

- Each cell is a percent input and (when `waveReps` is on) a reps input,
  separated by a hairline, both `tnum`.
- Arrow keys move between cells, Tab moves along the row, Enter commits and
  drops to the next row — the roving pattern already established for the
  set-row menu.
- Paste of a tab- or comma-separated block fills from the focused cell and
  reports what it wrote ("Filled 3 weeks × 3 sets"). This is the single feature
  that makes desktop worth the exception: authors have these in spreadsheets.
- Column add/remove lives in the header strip; row add/remove in a trailing
  `size-9` slot, matching the builder's trailing-slot rhythm.
- The `Deload` row is the same grid one row down, visually separated by the
  grouped-list closing hairline, and is dimmed with its hint when the deload
  policy is not `'scheduled'`.

**Both forms write the same model.** The phone's week sheet and the desktop
row are two editors over one `wave[weekIdx]` array; there is no desktop-only
field, and no data authorable on one and not the other.

## 07 · Layout: the desktop exception

DESIGN.md's Layout & Mobile rule is "single-column, max-width ~28rem, centered
— phone-first", with HOME as the one exception. This spec adds the second and
last one, in the same shape as the legal pages' `lg:grid-cols-[15rem_minmax(0,68ch)]`
rail (`src/app/(legal)/legal-page.tsx:31`):

- New layout token in `src/design/tokens.ts`:
  `content-max-width-editor: 840` — "Program editor only (52.5rem), from the
  editor breakpoint up." Regenerate the three outputs (`npm run tokens`).
- New named screen `editor: 52.5rem` in the Tailwind theme, so the exception is
  a named breakpoint and not a magic number sprinkled through class strings.
- Below 840px: exactly today's `max-w-md` single column. The pane navigator
  does not exist; days and exercises are the existing vertical flow.
- At 840px and up: `editor:grid editor:grid-cols-[15rem_minmax(0,1fr)]
  editor:gap-10`. Left pane is a sticky day/exercise navigator (a `DividerList`
  of days, each with its exercises, current one marked with **the screen's one
  volt**). Right pane is the exercise being edited, including the wave matrix.
- The volt budget is unchanged: one accent moment. The navigator's current
  exercise carries it; the matrix carries none, and the primary Save keeps the
  page's `default` button treatment as today.
- No card shells anywhere in either pane. The panes are separated by the gap
  and a single vertical hairline, not by two rounded surfaces.
- **DESIGN.md must record this** in Layout & Mobile alongside the HOME
  exception, or the next reviewer is right to reject it. The amendment lands in
  the same PR as the first pane component.

## 08 · The scheme picker

Today's mock shows three schemes and hides four behind a "4 more schemes" row.
That is backwards: the hidden four include both TM schemes, i.e. the two that
carry the most authoring intent, and progressive disclosure of an enum with
seven members buys nothing but a tap. **Ship all seven flat**, grouped by what
actually governs the load, because that is the only distinction a lifter needs
to make before reading the subtitles.

```
HOW THIS PROGRESSES                          (Section caps header)

THE WEIGHT MOVES
─────────────────────────────────────────────
Linear                                      ○
  Add weight every session you complete all sets.
Double progression                          ●
  Work up to the top of your rep range, then the weight
  goes up and reps start over.
Rep progression                             ○
  Same weight, more reps each session.
─────────────────────────────────────────────

A TRAINING MAX DRIVES IT
─────────────────────────────────────────────
Percent of 1RM                              ○
  Weights are percentages of your training max, which
  bumps a small fixed amount each cycle.
AMRAP cycle                                 ○
  Each week ends with an as-many-reps-as-possible set;
  beat your record to earn the next training-max bump.
─────────────────────────────────────────────

EFFORT AND VOLUME DECIDE
─────────────────────────────────────────────
RPE target                                  ○
  Loads are picked from your estimated max to hit a target
  effort — heavier on good days, lighter on bad.
Weekly volume                               ○
  Start at minimum growth volume, add sets weekly until
  recovery caps, then deload.
─────────────────────────────────────────────

No progression                              ○
  Targets stay exactly as written.
```

Rules:

- **Eight rows, one screen, no disclosure.** Sub-headers are the `Section` caps
  treatment; the rows are `DividerList`/`DividerRow`. The selected row's radio
  is the screen's one volt; the labels are words, never chips (chips mean
  pressable, and the *row* is the control here).
- **Copy is `SchemeCopy`, verbatim.** `schemeName()` and `schemeSubtitle()`
  already exist and are already the shared voice across the builder line, the
  detail sentence and the autoreg reasons (`src/lib/programs/scheme-copy.ts`). The
  picker adds zero scheme sentences; it adds only its group headers and the
  "No progression" row.
- **Group order is deliberate**: the three schemes most lifters want are first,
  the two that need setup are second and named for what they need, the two
  derived ones last. Nothing is hidden by that ordering.
- **Selecting a TM scheme pushes straight into its parameter surface** (§05/§06)
  with the TM field focused, rather than returning to a row with empty
  parameters. Backing out without completing leaves the previous scheme in
  place — an incomplete config is never saved.
- **Selecting `amrap-cycle` requires the `tmBumpTiming` choice before Save**
  (R1). The picker does not present it; the parameter surface does, unselected.
- **Metric-mode reality.** Load-anchored schemes no-op on timed sets by design
  (`program-input.ts:388` — enforced at derivation, not parse). On a
  `duration`/`duration_distance` exercise the four load-driven rows render with
  a muted hint ("This exercise is timed — load schemes won't change anything
  here") and stay selectable, because the model permits it and legacy programs
  store it. They are never silently removed.
- **States**: pending (`Ghost` rows, the 150ms rule), read-only (`proposed` and
  shared views render the current scheme as the `SchemeSubtitle` line only,
  no picker), error (the sheet stays open, message above the list, retry in
  place).

## 09 · Copy and i18n keys

Namespaces are the components that render them; leaves come from the
docs/I18N-KEYS.md vocabulary; scheme names and subtitles are **not** duplicated —
they stay in `SchemeCopy`.

```jsonc
"SchemePicker": {
  "title": "How this progresses",
  "group": {
    "load": "The weight moves",
    "trainingMax": "A training max drives it",
    "effort": "Effort and volume decide"
  },
  "none": {
    "label": "No progression",
    "description": "Targets stay exactly as written."
  },
  "hintTimed": "This exercise is timed — load schemes won't change anything here.",
  "ariaLabel": "Progression scheme for {exerciseName}",
  "error": "Couldn't save the scheme. Try again.",
  "loading": "Loading schemes"
},

"TrainingMaxField": {
  "label": "Training max ({unit})",
  "ariaLabel": "Training max for {exerciseName}, {unit}",
  "placeholder": "—",
  "hintFromE1rm": "Suggested from your estimated max — edit before saving.",
  "hintNoHistory": "No history for this lift yet — enter the weight you'd base percentages on.",
  "save": "Save",
  "cancel": "Discard",
  "badgeStaged": "Unsaved",
  "summaryChanged": "Changed {relativeTime}",
  "actionReduce": "Back it down",
  "actionHistory": "See changes",
  "error": "Couldn't update the training max. Try again.",
  "validation": "Enter a weight of 0 or more."
},

"TrainingMaxSheet": {
  "title": "Training max — {exerciseName}",
  "lede": "Every change to this number, newest first.",
  "empty": "No changes recorded yet.",
  "summary": "{before, number, ::group-off} → {after, number, ::group-off} {unit}",
  "reason": {
    "manual": "You changed it",
    "reset": "Backed down after misses",
    "cycleEnd": "Earned by completing a wave",
    "blockRestart": "Carried into a new block"
  },
  "confirm": {
    "titleManual": "Update training max?",
    "bodyManual": "{exerciseName}: {before, number, ::group-off} → {after, number, ::group-off} {unit}. Weeks you haven't started yet will use the new number.",
    "titleReset": "Back this training max down?",
    "bodyReset": "{exerciseName}: {before, number, ::group-off} → {after, number, ::group-off} {unit}. It's logged as a reset, not a routine change.",
    "confirm": "Save",
    "pending": "Saving…"
  }
},

"WeekPercentEditor": {
  "title": "Percent by week",
  "rowLabel": "Week {week}",
  "rowLabelDeload": "Week {week} · deload",
  "value": "{percent}%",
  "hintClamp": "Weeks {from}+ hold at {percent}%.",
  "hintOverrun": "Weeks {from}+ are past the end of this block and never run.",
  "add": "Add week",
  "remove": "Remove week {week}",
  "validation": "Enter a percent between 0 and 200.",
  "empty": "No week percents yet — add the first one.",
  "preset": {
    "label": "Start from a preset",
    "ascending": "Ascending 75/85/95",
    "wendler": "Wendler 65/75/85",
    "flat": "Flat"
  },
  "presetConfirm": "This replaces every week percent you've entered."
},

"WaveEditor": {
  "title": "Wave",
  "rowLabel": "Wave week {week}",
  "summaryPercents": "{percents}",
  "summaryReps": "{reps}",
  "hintRepeat": "Repeats every {count, plural, one {# week} other {# weeks}}. Deload weeks don't advance it.",
  "add": "Add wave week",
  "empty": "No wave yet — add the first week or start from a preset.",
  "increment": {
    "label": "Training max bump",
    "value": "+{increment, number, ::group-off} {unit} per completed wave",
    "hintStatic": "No bump — the training max stays where you set it."
  },
  "banked": "{count, plural, one {# wave} other {# waves}} banked into {trainingMax, number, ::group-off} {unit}",
  "preset": {
    "label": "Start from a preset",
    "fiveThreeOne": "5/3/1",
    "fivesPro": "5s PRO",
    "static": "Static"
  },
  "presetConfirm": "This replaces the wave, the reps and the deload row."
},

"WaveWeekSheet": {
  "title": "Wave week {week}",
  "rowLabel": "Set {set}",
  "percentLabel": "Percent",
  "repsLabel": "Reps",
  "badgeAmrap": "AMRAP",
  "toggleReps": "Prescribe reps",
  "hintReps": "Reps prescribed here replace the set's rep range.",
  "hintRepsOffConfirm": "This clears prescribed reps for every wave week.",
  "hintClamp": "Sets past {count} use {percent}%.",
  "add": "Add set",
  "remove": "Remove this week",
  "close": "Done",
  "validation": "Enter a percent between 0 and 200."
},

"DeloadRowEditor": {
  "title": "Deload row",
  "summary": "{percents}, {reps, plural, one {# rep} other {# reps}}",
  "empty": "No deload row — the deload backs off by the program's shape instead.",
  "hintUnscheduled": "Runs only on a scheduled deload. This program's deload policy is {policy}.",
  "hintTimed": "Only applies to weight-and-reps sets.",
  "add": "Add a deload row",
  "remove": "Remove the deload row",
  "validation": "Enter a percent between 10 and 100."
},

"TmBumpTimingControl": {
  "title": "When the bump takes effect",
  "description": "You complete a wave, so the training max goes up. This decides whether the deload week already uses the new number.",
  "option": {
    "afterDeload": "After the deload",
    "beforeDeload": "Before the deload"
  },
  "optionDescription": {
    "afterDeload": "The deload runs off the old training max; the new one starts the week after. This is how 5/3/1 is written.",
    "beforeDeload": "The deload already uses the new training max."
  },
  "validation": "Pick one — this changes what your deload week weighs.",
  "hintLegacy": "This program was written before the setting existed and kept its original behaviour.",
  "hintInert": "This program has no scheduled deload, so the setting has no effect right now.",
  "change": "Change",
  "confirm": {
    "title": "Change when the bump takes effect?",
    "bodyToAfter": "Week {deloadWeek} will use the training max from before this wave's bump — {oldTm, number, ::group-off} {unit} instead of {newTm, number, ::group-off} {unit}. Weeks after the deload are unchanged.",
    "bodyToBefore": "Week {deloadWeek} will use the training max from after this wave's bump — {newTm, number, ::group-off} {unit} instead of {oldTm, number, ::group-off} {unit}. Weeks after the deload are unchanged.",
    "confirm": "Change it",
    "pending": "Saving…"
  },
  "error": "Couldn't change the timing. Try again."
}
```

## 10 · Data-layer work this surface requires

None of it is UI. Listed so the spec isn't read as pure design.

1. **`setTmBumpTiming`** in `src/db/program-patches.ts`, event
   `set_tm_bump_timing`, plus the matching MCP patch tool and its entry in
   `PROPOSABLE_PATCH_TOOLS`.
2. **`adjustTrainingMaxAction` takes a reason**, restricted server-side to
   `'manual' | 'reset'` — the two engine reasons must be unreachable from a
   request.
3. **Remove `withDraftTrainingMax`** from `draftToProgramInput`
   (`src/app/programs/new/program-draft.ts:642`) so the full-replace save can
   no longer move a TM without an event. `seedTrainingMax` stays as a display
   seed.
4. **Absent-field preservation in `setTrainingMax`** — see §03's third test
   anchor. Today `parseProgression` will stamp `'after-deload'` onto a row that
   has no timing; either preserve the absent field across the merge or backfill
   the stragglers in a migration.
5. **Scheme-change patch op** — switching schemes rewrites the whole
   `progression` object; it needs a single audited op rather than riding
   full-replace, for the same reason the TM does.
6. **Stories** for every new component (`src/components/**`), with the real
   states from §04–§08, per CLAUDE.md.

## 11 · Out of scope, and open questions

### Out of scope

- Authoring the other five schemes' parameters — `linear`, `double-progression`,
  `rpe-target`, `weekly-volume`, `rep-progression` are single- or two-scalar
  configs and get plain fields in the same exercise block; they are not what
  makes this spec necessary.
- Per-week set overrides (`setOverrideSchema`) — a separate surface.
- Importing a wave from a spreadsheet file. Paste (§06 desktop) covers the real
  workflow without a parser.
- A TM per *exercise identity* rather than per program slot. TMs are stored on
  the slot today and the restart path already carries them; unifying them is a
  data-model change, not an authoring one.

### Open questions

- **Does the TM detail sheet belong on `/programs/[id]` or on the exercise's
  stats page?** The events are program-scoped; the number is arguably
  exercise-scoped. Spec position: program editor, because that is where it is
  edited — but the exercise stats page should link to it.
- **Wave presets' exact numbers** — "5s PRO" and "5/3/1" have canonical
  percents, but our `deloadRow` convention (40/50/60 × 5) is a choice, not
  doctrine. Confirm before shipping the chip.
- **840px vs 768px for the pane exception.** 840 gives the matrix four
  comfortable set columns at the 15rem navigator width; 768 gives three. The
  spec takes 840; if the navigator collapses to icons the smaller number
  becomes viable.
- **Should `bankedWaves` be visible at all?** It is engine bookkeeping and
  arguably noise. Spec position: show it, muted, because it is the only thing
  that explains why a stored TM already includes bumps the wave math won't
  re-add.
