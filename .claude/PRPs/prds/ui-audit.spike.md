# SPIKE — App-Wide UI Audit (all screens post-drawer/home)

Six parallel audit agents (2026-08-03), one per screen group, each:
code-read → sins named → exemplar research → sin→pattern→recommendation
map. Trigger: "figure out what our ui sins are... map those out to
award winning or fantastic ui/ux patterns." This doc is the ranked
synthesis of all six reports.

## The one diagnosis, everywhere

Every audited screen predates the drawer/home design language and shows
the same disease those two cured: **stats presented instead of status
told, uniform quiet-card grammar, no zones, achievement without
celebration, tier-3 data on tier-1 real estate**. The fixes below are
mostly *applying our own established language* (font-display verdicts,
one big number, zones, volt = action+achievement, empty states as
invitations) — low design risk, and nearly all of it is derivation over
data already fetched (zero new queries in most items).

## Cross-cutting patterns (from the exemplar research)

1. **Verdict-first** (Gentler Streak/Athlytic): every stats-ish surface
   opens with a font-display editorial verdict + one context sentence.
   Applies to: /stats ("BACK IS BEHIND."), program stats ("GETTING
   STRONGER."), /history status line, /body trend hero, workout
   summary's specific headline ("TWO PRS." not "WORKOUT COMPLETE").
2. **No number without direction** (WHOOP/Strava): deltas everywhere —
   summary stat tiles vs last same-name session, e1RM "+5 vs last
   month", measurement 90d deltas, exercise-list micro-trends.
3. **The block map** (TrainerRoad/Juggernaut): ONE shared mesocycle
   visualization component — week segments with day-fill, deload
   hollow, current ringed — used on programs list hero, program detail
   strip, program stats rows. Learn once, read everywhere.
4. **Rows are alive** (our own drawer rule, unfinished): /exercises,
   /templates, /history rows still show bookkeeping instead of status.
5. **Celebration is under-built** (Apple Fitness/Strava): trophies look
   like settings rows, PR deltas are computed then discarded, goals
   achieve without a moment, sets complete silently.
6. **Tier discipline** (WHOOP): collapse non-next-up program day cards,
   cap /body history, session set-walls → best-set summaries.

## Ranked build arcs (impact × frequency-of-use ÷ effort)

### Arc A — The logger's sensory layer (S/M items, highest frequency)
1. Rest-timer end alert (vibrate + optional chirp + title flash — no
   push, honors the notifications decision) + mid-rest −15/skip/+15
   strip in the sticky bar (current period only; never touches
   defaults or plan restSec).
2. Set-completion haptic + motion-safe scale-pop; stronger on
   exercise-complete.
3. Session pulse: 14/20 sets count by the header clock + Next-up
   glance ungated from rest.
4. Smaller: enterKeyHint flow, warm-up gesture hint, per-side plate
   chip on focused weight row, persistent micro-target caption when a
   typed value hides the ghost, "ALL SETS DONE." editorial line.

### Arc B — Verdicts + deltas (the Gentler/WHOOP pass, mostly S/M)
1. /stats: verdict zone + bullet-chart re-encoding (performed bar
   inside target track; volt=on-plan only), shortfall-first sort,
   window toggle demoted and de-jargoned.
2. Workout summary: specific headline resolver, named PR delta lines
   (computed at page.tsx:123-141 and discarded today), "vs last
   {name}" stat sub-lines, e1RM direction arrows, share button in the
   celebration zone, staggered motion.
3. /history: sticky month headers with rollups, editorial status line,
   volume-normalized row emphasis, invitation empty state.
4. Program stats: verdict hero, PRs reordered above admin sections,
   merged week rows (adherence+volume, deload hatched), per-exercise
   e1RM sparklines.

### Arc C — The block map (one shared component, M)
Programs list active-hero card ("WK 3 OF 7" + segment bar + next-day
line; New Program demoted below), program detail week strip (day-fill
segments replacing binary-dot pills), program stats week rows. Plus
detail: WHOOP-collapse of non-next-up day cards (UX + perf win — skips
derivation reads for collapsed days), editorial status line, autoreg
visibility card ("Bench held — stalled 2×"), zoned tail
(changes/sharing/danger separated).

### Arc D — Alive rows (extends the drawer pattern, S/M)
1. /exercises: status second lines (best e1RM + trend delta),
   MOVING/TRAINING/DORMANT zones, muscle-group facet chips + sort,
   relative-words recency. (One query change: bestE1rm/delta on
   listLoggedExercises.)
2. /templates: last-done + volume second lines from summaries already
   fetched on the page, most-recent hero Start (volt), recency sort,
   edit-in-sheet, invitation empty state.
3. wger library: group by days/week zones, day-name chips instead of
   raw prose, adopted state ("In your programs →"), single CTA.

### Arc E — Goals/Trophies/Body glow-up (M, the motivation surfaces)
1. /goals: one-big-number cards sorted by tension (volt ≥90%),
   week-tick streak row replacing the percent bar, bodyweight goal
   gets TrendChart + targetValue (supported, unused), pace projection
   promoted, destructive actions behind ⋯, achieved = "DONE." moment
   + share card.
2. /trophies: medal treatment (layered volt radial, threshold number
   as hero glyph), family zones (PLATE CLUBS / SHOWING UP / TONNAGE),
   CLOSEST zone at top (highest-% locked), progress bars on locked,
   newest-first + NEW tag, staggered reveal.
3. /body: trend-weight hero (7d EMA + editorial direction line, raw
   reading demoted), EMA series + goal reference line on the chart,
   history capped at 5, measurement delta lines, same-pose default
   compare + overlay-slider mode, photo cadence nudge.

### Arc F — Housekeeping (S, one small PR)
/settings: TRAINING/DATA/INTERNAL zones, benefit-first microcopy,
identity block + sign-out + version, drop-zone file card + step
indicator on import. Exercise detail refinements: recent-window delta
(not vs-first-ever), volt PR dots on the chart, time-true x-axis,
record-standing-time captions, collapsed session history.

### Arc G — Coach polish (M, trust-critical)
Humanized approval cards (describeToolCall map — the highest-stakes
moment renders raw JSON today; JSON demoted behind <details>),
contextual follow-up chips, context-aware starters, day separators,
New chat → header slot, de-volt user bubbles.

## Data-shape prerequisites (the only query changes anywhere)
- PR-count + programWeek on WorkoutSummary (history achievement chips,
  summary context) — own PR.
- bestE1rm + trend delta on listLoggedExercises (/exercises rows).
- Numerator/denominator exposed from trophy evidence (progress bars).

## Suggested order
A (daily-use payoff) → B (the language lands everywhere) → C (the
missing product visualization) → D → E → G → F. Each arc = 1-3 small
PRs per house rules.

## Sources
Aggregated across the six agent reports: Hevy (live activity, rest
timer, routines, library), Strava (feed emphasis, trophy case,
strength overhaul + muscle maps), Gentler Streak (status-in-words,
monthly recap), WHOOP/925studios (tiers, one number, color
vocabulary), Happy Scale/Withings (trend-over-noise), Apple Fitness
(awards, rings), TrainerRoad/TrainingPeaks/JuggernautAI/Runna/RP
(block visualization, volume landmarks), Striv (PR celebration),
Setproduct/aiuxdesign (AI-chat anatomy), Material/iOS (settings
zones).
