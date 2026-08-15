# Logger UX overhaul — research-backed direction (issues #208–#219, #224 + progression-trust batch)

Direction document synthesized from five research passes (2026-08-15): competitor
benchmarking (Hevy, Strong, Boostcamp, Alpha Progression, JuggernautAI, RP,
Fitbod, TrainHeroic), platform guidance (Material 3, iOS HIG, WCAG, NN/g,
a11y-toast literature), and a full internal audit of every affected surface
against DESIGN.md. Sources are cited in the research transcripts; the load-bearing
ones are inlined.

## The one-paragraph verdict

Nothing here is architecturally wrong. The rest pill + sheet is exactly Strong's
compact→expanded split; the post-check effort chip row is the strongest pattern
observed in the field (Boostcamp/Juggernaut hybrid); the picker sheet, the pin
chip, and the skip-by-ignoring effort contract are all correct. What's broken is
**vocabulary discipline**: one `outline` button doing five jobs, four different
destructive treatments, volt spent three times per sheet, 32–36px touch targets
on the sweatiest mid-set controls, card shells nested inside sheets, and three
note surfaces with three different grammars. The fix is a foundation pass
(button roles + a shared countdown/segmented vocabulary + a touch-target sweep),
then per-surface conversions that consume it. A second, independent theme
surfaced from live use: **progression-engine trust** — unloadable suggested
weights (37.2 lb), overshoot scored as failure, and reason copy that doesn't
explain itself.

---

## Foundation: #212 button & control vocabulary (build FIRST)

Audit found: `outline` covers constructive (+ Add set, + Exercise), reversal
(Undo), commitment (Use for block), paperwork-primary (Save changes), and —
with three hand-typed classes — destructive (Discard). The real `destructive`
variant is used once. The live Finish button is not a variant at all but a
className override (`-mx-5 … bg-primary/15 font-display text-primary`) —
invisible to Storybook and unportable to SwiftUI/Compose, against DESIGN.md's
token-portability rule. `button.tsx` carries `button-group` data-slot hooks that
nothing sets; no segmented primitive exists.

**Direction — a role → variant contract:**

| Role | Variant | Treatment |
|---|---|---|
| The screen's one primary action | `default` | solid volt (unchanged) |
| Session-peak action (live Finish) | **new `band`** | full-bleed volt-tinted display-face band — today's override, named, storied, tokened |
| Constructive-additive (Add set/exercise) | `outline` | unchanged; `outline` now means *only* "adds something" |
| Quiet utility (tool rail, sheet close) | `ghost` muted | unchanged |
| Reversal (Undo, Just today, Use plan as written) | **new `reversal`** (ghost + underline offset) | quiet but distinguishable from utility |
| Destructive commit (dialogs: Replace, Delete) | `destructive` | the existing tinted variant, only in confirm surfaces |
| Standing destructive (Discard workout) | **new `destructive-outline`** | today's hand-rolled Discard classes, named |
| Segmented clusters (stepper, −15/Skip/+15) | **new `ButtonGroup` primitive** | activates the existing data-slot hooks |

**Plus two systemic fixes in the same slice:**
- **Touch-target sweep**: the `before:-inset-1` invisible-inset trick exists on
  remove-set and rest-sheet presets but is missing on the stepper (36px), the
  rest pill's ±/Skip (36px), and the effort chips (32px) — the three most
  mid-set controls in the app. Standardize: every sub-44px control gets the
  inset. Consider a `hit-44` utility.
- **Lint ratchet under-detects**: the rule bans `rounded-2xl`+`bg-card` only;
  the shells the audit found all use `rounded-xl`. Add `rounded-xl` (or a
  combined shell heuristic) to the banned pattern with the same allowlists.

Every new variant lands in `button.stories.tsx`'s matrix and as tokens
(DESIGN.md: className strings don't port; tokens do).

## #210 in-session toast/prompt family

Current: two `rounded-xl border bg-card` strips inside the sticky bar (card
shells on a non-overlay surface — not keep-list eligible; they survive lint only
via the ratchet). Mount animates (`rise-in`); dismissal is a hard cut. Undo
auto-dismisses at 5s with **no visible countdown**; the block/undo prompt has no
timer by design.

**Direction — one `SessionToast` component, two modes:**
- Skin: hairline-bordered strip on the page background (no card shell),
  full-width minus gutter, message + action per the new button roles
  (`reversal` for Undo; `outline` sm for Use for block; `reversal` for Just today).
- **Countdown voice**: a 2px volt hairline across the bottom edge draining via
  `transform: scaleX(1→0)`, `transform-origin: left`, linear, implemented as a
  CSS animation so `animation-play-state: paused` gives free pause-on-
  hover/focus-within (WCAG 2.2.1). This is the *same* drain primitive the rest
  pill already uses — one countdown vocabulary app-wide.
- **Duration**: raise `UNDO_WINDOW_MS` 5s → **8s** (M3: action-bearing
  snackbars sit at the long end of 4–10s; a11y literature: actions in
  auto-dismissing toasts need generous timers). The block/undo *prompt* keeps
  no timer (persists until answered) but adopts the same skin sans hairline.
- **Motion**: enter `translateY(12px)→0` + fade, 200ms `cubic-bezier(0.16,1,0.3,1)`;
  exit fade + `translateY(0→8px)`, 150ms accelerate (exit < enter, per M3);
  undo-pressed exit 100ms fade. Reduced motion: opacity-only 150ms, countdown
  becomes a ticking "· 8s" text suffix instead of the animated hairline.
- **A11y**: keep `role="status"`; exit animation must not unmount before AT
  announces; the undone/blocked change stays reversible from the program screen
  afterward (toast is never the only path).
- Stacking semantics (removed[] array, Undo (n)) and coexistence of both strips
  survive unchanged; volt budget: the drain hairline is the strips' only volt —
  Finish keeps the screen's solid volt.

## #216 weight stepper

Current: ghost/sm pair in a `bg-card` wrapper (36px, no inset), one step per
tap, shown while the weight input holds focus; `onPointerDown` preventDefault
keeps the keyboard up (load-bearing on iOS).

**Direction:** extract into its own keep-listed component (precedent:
`rest-pill.tsx`) built on the new `ButtonGroup`:
- Hairline-topped accessory rail aligned to the input columns: `−{step}` /
  `+{step}` as text chips (≥44px effective, ≥64px wide), step value visible in
  the chip — never bare icons.
- **Hold-to-autorepeat** (the UIStepper convention): first repeat after 400ms,
  then ~150ms interval, accelerating (5× step after ~8 repeats). Tap = one step.
- Steps stay plate-meaningful via the existing `WEIGHT_STEP[unit]` +
  ghost-seeded `stepWeightValue` — the Alpha Progression lesson is that
  increments should be loadable, which they already are. No plate-calc UI here
  (the plate sheet already exists).
- Feedback: 150ms `scale(0.97)` press, 150ms opacity dip on the value,
  `vibrate(10)` per step; reduced motion = instant swap only. Min-clamp at 0 =
  40% opacity, still full hit area.
- The focus-preservation + blur-to-dismiss lifecycle is untouchable.

## #217 rest controls

Architecture validated (Hevy uses −15/+15/Skip; Strong uses compact→expanded).
Problems are affordance weight, not structure:
- **Pill**: ±15 and Skip are visually identical 36px ghosts; Skip is the
  terminal one. Rebuild the trio on `ButtonGroup` with insets to 44px
  effective; Skip separates from ± (position + the `reversal` treatment) so the
  irreversible control reads differently. ±15s stays the increment (field
  standard). Digits already tabular; last-10s digits flip to volt (color only).
- **Sheet**: currently spends volt three times (selected preset, Save, chime-On).
  Adopt the effort-chips precedent — selected chips use `bg-foreground
  text-background`, not volt — leaving Save as the sheet's one volt. Preset
  pills already carry the inset; keep.
- The pill's 1s tick ownership and the exported/tested `restReadout`/
  `restProgressFraction` pure functions don't move.

## #208 effort capture

Field research says our pattern (post-check, inline, target-anchored, optional)
is the strongest one observed; JuggernautAI's mandatory prompts and RP's surveys
are the documented failure modes. Keep the pattern, tune the presentation:

- **One vocabulary shown at a time** (Boostcamp's dual-field confusion): the
  program's scheme decides RIR or RPE; the scale-switch link stays as escape.
- **Chips 32px → 44px effective** (inset trick), and cut RPE strip density:
  whole points 6–10 as chips (5 chips fit without scrolling), half-points via
  the chip's second tap cycling `8 → 8.5` — kills the undiscoverable scroll.
- **Target affordance**: the chip matching the prescribed target gets a hairline
  ring — *not* volt (selection already correctly uses `bg-foreground`).
  Prescribed target stays a muted word near the ghost; logged value keeps
  collapsing to the quiet tappable word ("RIR 2").
- **Dismissal**: keep skip-by-ignoring (zero-tap default, non-blocking,
  contract-pinned); add a ~5s idle collapse so an ignored row tidies itself
  (research: auto-dismiss on next interaction or idle). Never re-prompt; the
  collapsed word/slot stays tappable to log late.
- Needs a `.stories.tsx` when it becomes a shared component.

## #209 exercise picker de-card

The **sheet shell stays** (keep-listed; elevation is the point of an overlay) —
the violations are inside `exercise-picker.tsx` (ratcheted): three nested card
shells (results ul, suggestions ul, create form), compact non-contract rows with
per-row Add buttons, a hand-rolled caps header, a non-EmptyWords empty state,
and **three volt moments** (sheet eyebrow, create-form eyebrow, muscle chips +
Create & add).

**Direction:** convert contents to the de-card recipes with
`src/app/exercises/library-filter.tsx` as the compliant reference:
- Results/suggestions become hairline divider lists (`divide-border/60`, closing
  hairline), rows `py-4` with muted metadata + the **row as the control** —
  per-row Add buttons die (see #213). The combobox a11y markup
  (`role="listbox"`/`option`/`aria-activedescendant`) is applied the row
  *recipe*, not `DividerRow` verbatim (it renders `li > Link`).
- Headers use the Section caps recipe; empty states become `EmptyWords`-shaped
  sentences; the raw `<select>` adopts the field vocabulary.
- **One volt**: sheet eyebrow and create-form eyebrow go muted; muscle-chip
  selection goes `bg-foreground` (effort-chips precedent); the volt is the
  single primary action (Create & add / the add-mode commit).
- The conversion PR deletes `exercise-picker.tsx` from `CARD_SHELL_RATCHET`.
  The picker is shared with the program builder — both hosts move together; the
  inline `max-h-72` variant survives.

## #213 replace-mode spec

Industry convention is unanimous (Hevy, Fitbod): **replace = single-select,
terminal, seeded with alternatives; add = multi-select batch**. No mainstream
app exposes Add inside replace.

- Replace mode: title "Replace {name}" (exists), alternatives rail (exists),
  **no Add affordance anywhere**, tapping a row *is* the swap (no confirm step —
  the logged-work guard dialog already covers the destructive case) and
  dismisses.
- Add mode: rows toggle selection (checkmark), one volt commit button; the
  redesigned add affordance in the logger is the existing bottom-bar
  `+ Exercise` (outline `lg`) — inside lists, "add" becomes a full-width
  hairline row, never a floating +.

## #218 create custom exercise from the swap

Creatable-select convention + contact-picker return flow (NN/g: multi-field
forms are pages, not sheets):

- Picker shows near-matches, then a final `Create "{query}"` row (also the
  true-empty state's action; empty state itself is a plain sentence).
- Full page push `/exercises/new?name={query}&return=swap&target={instance}` —
  name prefilled from the query; only name + logging type required, muscles/
  equipment optional (create-with-title, enrich later).
- **Contextual primary**: "Save & replace" when arriving from replace mode
  (creates, swaps the target instance, lands back in the logger with the swap
  done — never on a detail page, never back in the picker); "Save & add" from
  add mode; plain "Save" from the library.
- Back/cancel restores the logger with the sheet re-openable and query intact
  (the draft already survives navigation via the draft store). Guard dupes via
  the near-match rows above Create.

## #211 notes — the missing tier

Diagnosis: not a styling problem — three entry grammars (icon rail toggle /
full-width ghost button / always-present chip) and no middle tier between
"session-only write-only note" and "pinned forever". Strong's three-tier model +
Hevy's one-session echo is the direction:

| Tier | Lives on | Surfaces as |
|---|---|---|
| Workout note | the session | plain line under the session header (existing placement is right) |
| Exercise note | this session's exercise | inline under the exercise header (existing) |
| Pinned note | exercise identity | muted pin-glyph line/chip every future session (existing `stickyNote`) |

- **One entry grammar**: a "Note" chip in the exercise control rail replaces the
  icon toggle; when a note exists the note text itself is the tap target
  (chips are controls, words are labels). Workout-level keeps its labelled
  affordance but adopts the same chip skin.
- **Pin is a promotion**, not a separate input: a pin control on an existing
  exercise note converts it (Strong). This activates the intentional
  `?? true` groundwork in the QuickCaptureSheet for create-from-logger.
- **The new piece — last-session echo**: an unpinned note from the previous
  session of this exercise renders once, greyed/italic, read-only,
  tap-to-copy-into-editor, dropped after this session (Hevy). This is what
  makes session notes worth writing without forcing the pin decision, and it's
  the tier we've never had.
- Pinned notes stay quiet (muted + pin glyph, never volt — banner blindness).
  Invariants preserved: open-OR-has-notes (a hidden note is a lost note),
  pinned-only gate in `stickyNote`. Skip: custom voice input (OS keyboard mic
  suffices), note templates.

## #219 cardio — three small slices, no platform

Every logging-centric competitor models cardio as **a regular exercise whose
sets switch to duration/distance fields** — and the schema already has
`metricMode` / `durationSec` / `distanceM` on program sets + overrides,
`rep-progression` already bumps seconds, and `session-best-set.ts` already
fences non-`reps_weight` sets out of volume/e1RM. This is reuse, not build:

1. **Slice 1 — prescribe + log**: builder set rows swap rep/load inputs for
   mm:ss + optional distance when `metricMode ≠ reps_weight`; wger Cardio
   category defaults new adds to `duration_distance`; logger ghosts show target
   duration/distance (plan targets only, per ghost-vs-prev), manual entry,
   Prev chip = last duration/distance. Optional intensity = the existing RPE
   column as an effort cap (zone-2 / C25K prescribe RPE; the app already
   speaks it).
2. **Slice 2 — progression**: `rep-progression` on seconds (covers C25K ramps
   and zone-2 minutes/week); guard the other six schemes off non-`reps_weight`
   exercises.
3. **Slice 3 — stats**: Hevy's PR trio (longest duration, longest distance,
   best pace) on exercise detail + a weekly cardio-minutes aggregate.

**Not in v1** (explicit): wearable/Strava/HealthKit import, HR zones, pace
targets, intervals-within-an-exercise, a separate session type, cardio→autoreg
fatigue coupling, distance progression, TSS.

## Progression-engine trust (new batch, 2026-08-15 session feedback)

Three live-use reports, one theme: the engine's outputs must be **loadable,
fair to overshoot, and self-explanatory** — or the lifter stops trusting every
number it prints.

1. **Equipment-aware load quantization.** The engine suggested 37.2 lb (calf
   raise) and displays 66.6 lb in a reason string — kg-derived values surfaced
   raw in lb. The user's gym has 35 or 40. Direction: quantize every
   *suggested/displayed* load to the user's equipment (the plate-math module +
   stored Equipment already exist) or, absent equipment data, to the unit's
   standard increment (2.5 lb / 1.25 kg). Round-at-display for reasons/ghosts;
   round-at-derivation for prescriptions so progression compares like with
   like. Stored kg facts stay exact — quantization is a presentation/derivation
   boundary, never a mutation of history.
2. **Overshoot policy is a program setting (#227).** Target 12×37.2; lifter did
   15×35 — higher e1RM, scored "goal not met". Research splits by goal:
   double-progression and 5/3/1 doctrine are load-anchored ("master a weight
   before you increase it"; Wendler's fixed TM bump regardless of AMRAP size),
   while hypertrophy logic treats equal-e1RM stimulus as equal. So: a named
   three-value policy — `strict-load` / `e1rm-equivalent` / `any-metric` —
   at program level with per-exercise override (strict on comp lifts,
   equivalent on accessories). Per-scheme defaults: strict for linear,
   double-progression, rep-progression, percent-1rm, amrap-cycle (overshoot
   never auto-accelerates TM; at most feeds the effort-step proposal path);
   e1rm-equivalent for rpe-target; set-count for weekly-volume. Evaluated
   against the snapshotted prescription. Even under strict policy, overshoot
   renders as recognition (rep PR / e1RM up), never as "goal not met" — the
   reported case is a display lie regardless of scheme semantics. No
   competitor names this setting; Liftosaur scripts it, Stronglifts hard-codes
   strict — it's a differentiator.
3. **Plain-English voice for every scheme (#228, expanded).** Not just the
   reason strings — one copy module owns a plain-language template per scheme,
   used in three places so they can't drift: (a) the builder's scheme picker
   as name + one-line subtitle (Liftosaur's pattern; e.g. double-progression:
   "Work up to the top of your rep range, then the weight goes up and reps
   start over"), (b) a muted "how this progresses" conditional sentence on
   program rows with the exercise's actual numbers (Stronglifts pattern:
   "Hit 12 reps on every set at 65 lb → +5 lb next session"), (c) the
   autoreg/derivation reasons, rewritten imperative with quantized loads —
   "Range not filled at 66.6 lb — adding reps before the load steps" becomes
   "Stay at 65 lb — hit 12 reps on every set, then the weight goes up."
   Research takeaway: conditional sentences with the lifter's real numbers
   beat scheme names in every consumer app observed.

(Related explanation, no code change needed: the "did 205×8, got prescribed
190×10" case was the now-removed `rpe-target` scheme working as designed —
10 reps @ RPE 8 prices at ~71–74% of e1RM, and 205×8 → e1RM ≈ 260 → ~190.
The program's conversion to double-progression on 2026-08-11 makes future
prescriptions anchor on last performed load instead.)

## #224 MCP swap sanitization (engineering, no design)

Route the MCP `update_program_exercise` identity-change case through
`substituteProgramExercise` (or add a dedicated `substitute_program_exercise`
tool and document identity changes on the old tool as load-preserving relabels).
Decision needed: silent behavior change vs new tool — recommend the **new tool +
docs change**, since the coach prompt layer can then choose intent explicitly.

---

## Build order

1. **#212 foundation** — variants (`band`, `reversal`, `destructive-outline`),
   `ButtonGroup`, touch-target sweep, lint-ratchet tightening. Everything else
   consumes this.
2. **#210 SessionToast** — the countdown-hairline primitive (shares the drain
   vocabulary with the rest pill).
3. **#216 + #217** — stepper extraction and rest-control rebalance on
   `ButtonGroup`.
4. **#208 effort polish** — density, hit areas, target ring, idle collapse.
5. **#209 + #213 together** — picker de-card + replace-mode spec (same files;
   one conversion PR deletes the ratchet line).
6. **#218 create-from-swap** — builds on the converted picker.
7. **#211 notes IA** — independent; can parallel 5–6.
8. **#219 cardio** — three slices, independent track.
9. **Progression trust** — quantization, overshoot scoring, reason copy;
   independent track, high urgency (it erodes trust in every session).
10. **#224** — independent, any time.

Each numbered item is one PR-sized slice (or explicitly sub-sliced above),
tests ride along, every touched component gets/updates its story, and
conversion PRs shrink the ratchet.
