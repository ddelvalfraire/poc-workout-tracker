# History & Records — Global Exercise History, Streak Calendar, PR Celebration

## Problem Statement

The app nails the *log* half of the loop but under-serves the *review* and
*payoff* halves. Three concrete gaps:

1. **No global exercise history.** "What did I do last time?" is answered only
   in-context (the logger's last-performance hint) and per-program (Program
   Stats). There's no screen that shows one lift's all-time arc across every
   session — the single most-requested view in any serious tracker.
2. **No consistency signal.** Nothing on the home screen rewards showing up.
   There's a "trained today" gate but no streak, no month view of trained days
   — the cheapest, highest-frequency motivation surface goes unused.
3. **PRs are noticed too late and never collected.** A PR badge already renders
   on the *completed-workout detail* page (`workout/[id]/page.tsx`), but the
   lifter only sees it if they reopen the finished session. The moment that
   actually matters — finishing the set that beats your best — passes silently,
   and there's no all-time "records" surface to admire.

## Evidence

- Product purpose (`PRODUCT.md`): "a friction-free start → log → **review**
  loop … and trusting the history days later." Review is a named pillar with
  thin surface today.
- Brand (`PRODUCT.md`): "strong, fast, no-nonsense … like a piece of gym
  equipment." PRs and streaks are exactly the bold, high-contrast payoff the
  brand asks for; the volt accent currently marks only primary actions.
- Existing PR logic (`src/app/workout/[id]/page.tsx:59-99`) proves the
  detection is wanted and already solved — it's just stranded on a page nobody
  reopens mid-session.
- Program Stats PRD explicitly *kept global exercise history unchanged* and
  accepted cross-gym noise there — leaving global history as known, deferred
  territory this picks up.

## Proposed Solution

Three related, read-mostly features over data already stored — no new domain
model, one small optional table for the records cache (deferrable).

1. **Global exercise history page** (`/exercises/[source]/[id]`): all-time
   top-set / e1RM / volume trend for one movement, "last time" up top, session
   list below. Reuses `getExerciseHistoryBefore` shape, `bestScoredSet`, and
   the Program-Stats viz idiom (tables + inline bars, no chart library).
2. **Streak + training calendar** on the home screen: current streak count and
   a month heatmap of trained days. Pure read over `workouts.completedAt`,
   computed in the user's **local** calendar (the same local-day lesson the
   codebase already learned when `TrainedTodayGate` moved client-side).
3. **PR celebration, promoted to the moment of truth**: extract the existing
   detection into a shared `lib/records.ts`, fire a volt-accent badge + haptic
   **in the logger** when a completed set becomes a PR, and add an all-time
   **Records** surface (best e1RM / heaviest / best reps / best volume per
   exercise) reachable from the exercise history page and/or a Records tab.

## Key Hypothesis

We believe surfacing all-time per-exercise history, a consistency streak, and
in-the-moment PR feedback will make lifters open the app to *review*, not just
log, and reinforce showing up.
We'll know we're right when a lifter can answer "am I getting stronger on X?"
and "how consistent have I been?" without opening individual sessions, and PRs
are seen the moment they happen rather than never.

## What We're NOT Building

- **A charting dependency.** Same discipline as Program Stats — inline SVG
  sparklines / bars only. POC bundle stays lean.
- **Cross-gym normalization for global history.** The Program Stats trade-off
  stands: global history mixes gyms and that's accepted; the per-program view
  is where gym-clean numbers live. Global history may carry a light "numbers
  span gyms" note, nothing more.
- **Retroactive bodyweight-at-the-time for historical e1RM.** e1RM for
  bodyweight lifts scores under the *current* stored bodyweight (matching
  today's PR-badge behavior). Historical BW snapshots are out of scope; flagged
  as a known approximation.
- **Streak rules gamification** (freezes, milestones, push nudges). v1 is a
  count + calendar; streak-save mechanics are a later idea, not this cut.
- **Social / sharing a PR.** Out of scope for the POC.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Answer "getting stronger on X?" from one screen | e1RM trend + last-time visible per exercise | Manual walkthrough on real history |
| Consistency visible at a glance | Streak + trained-days month render on home | Home screen on a seeded account |
| PRs seen in the moment | Badge fires in logger on a PR set completion | Log a set that beats a prior best |
| No charting dependency added | 0 new viz packages | PR diff / package.json |
| Local-day correctness | Streak/calendar match the user's wall clock across timezones | Test around midnight / DST |

## Open Questions

- [ ] Records surface placement: a **tab on the exercise history page**
      (per-exercise) vs. a **global Records screen** (all lifts) vs. both.
      Proposal: per-exercise records on the history page in Phase 5, defer a
      global Records index to a follow-up.
- [ ] Which PR axes celebrate live: e1RM only, or also heaviest-weight and
      rep-PR? Proposal: mirror the existing badge (e1RM PR *and* rep PR under
      `bestScoredSet`), add heaviest-weight as a distinct axis only on the
      records surface, not the live badge (avoid badge spam per set).
- [ ] Streak definition: does an **in-progress** (uncompleted) session count
      "today"? Proposal: streak counts completed sessions; today is "kept alive"
      by an active session so a mid-workout lifter doesn't see a broken streak.
- [ ] MCP parity: expose `get_exercise_history` / `get_records` read tools so
      Claude can answer "what's my bench PR?" Proposal: yes, later phase,
      following the Program-Stats `get_program_stats` precedent.

---

## Users & Context

**Primary User**
- **Who**: The app owner — a lifter with real multi-week history across a home
  gym and a commercial gym, running programs and ad-hoc sessions.
- **Current behavior**: Scrolls the flat workout list and opens individual
  sessions to reconstruct an exercise's progress; never revisits a finished
  workout just to see a PR; has no sense of streak.
- **Trigger**: "Did I move up on bench?" mid-block; the dopamine of a fresh PR
  while still holding the bar; the pull to not break a run of gym days.
- **Success state**: Taps a lift → sees its arc and last-time instantly; sees a
  streak + trained-days calendar on open; gets a badge the instant a set is a
  PR.

**Job to Be Done**
When I finish or plan a session, I want to see how a lift has trended, how
consistent I've been, and whether I just set a record — without digging through
individual workouts.

**Non-Users**
Coaches reviewing clients, multi-user scenarios — out of scope for the POC.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Global exercise history page (trend + last-time + session list) | The core missing review surface |
| Must | Shared `lib/records.ts` extracted from the existing badge logic | De-dupes detection; unblocks live badge + records surface |
| Must | Streak count + trained-days month calendar (local-day) | Cheapest, highest-frequency motivation |
| Must | Live PR badge in the logger on set completion | Payoff at the moment of truth |
| Should | Per-exercise all-time records (e1RM / heaviest / reps / volume) | Collectible payoff; reuses records lib |
| Should | Entry points: tap an exercise from logger/detail/history → its page | Discoverability of the new surface |
| Could | MCP `get_exercise_history` / `get_records` read tools | Claude-facing parity, MCP-first app |
| Won't | Charting lib, cross-gym normalization, historical BW snapshots, social | See "Not Building" |

### MVP Scope

Phase 1 ships the shared records module (tested, kg-domain) — the keystone that
both the live badge and the records surface depend on, and that removes the
duplicated detection from `workout/[id]/page.tsx`. Phases 2–4 layer the three
user-facing surfaces on top; each is independently shippable.

### User Flow

- **History**: any exercise name (logger last-time row, workout detail card,
  program view) → `/exercises/[source]/[id]` → e1RM sparkline, best-set trend,
  "last time 185×8", reverse-chron session list → optional Records tab.
- **Streak**: open app → home shows "🔥 5-day streak" + a month grid with
  trained days marked in volt; today highlighted.
- **PR**: complete a set in the logger that beats your prior best → inline volt
  "PR" badge + haptic pulse (reduced-motion: badge only, no pulse).

---

## Technical Approach

**Feasibility**: HIGH — read-mostly over existing columns; one optional cache
table; zero required migrations for the MVP.

**Architecture Notes**
- **Detection already exists** and is careful: `workout/[id]/page.tsx:59-99`
  scores best-set-per-exercise with `bestScoredSet` (`src/lib/one-rep-max.ts`),
  honoring logging type, effective load, e1rm-vs-reps "like beats like," and
  the "badge once per exercise" rule. Phase 1 lifts this verbatim into
  `src/lib/records.ts` and points the detail page at it — behavior-preserving.
- **History corpus** already exists: `getExerciseHistoryBefore` and
  `getLastPerformance` (`src/db/workouts.ts:72-132`). The history page needs a
  sibling that returns per-session best sets for one exercise ordered by date
  (a thin aggregate in the same Drizzle style).
- **Identity is the composite `(source, wgerExerciseId)`** — `source` is
  `'wger' | 'custom'` and the id column is reused for custom ids
  (`schema.ts` `workoutExercises`). ⚠️ The existing badge keys history by
  `wgerExerciseId` **alone**; a global per-exercise page MUST key on the
  composite or a custom exercise could collide with a wger id. Route is
  `/exercises/[source]/[id]`; queries filter both columns. This is the top
  correctness note.
- **e1RM math** (`estimate1RM`, `effectiveLoadKg`, `MAX_RELIABLE_REPS`,
  `bestScoredSet`) is reused as-is; display always labels "Est." per the
  `MAX_RELIABLE_REPS` convention.
- **Local-day is a settled lesson**: `TrainedTodayGate` moved client-side
  precisely because "today" is unanswerable server-side. Streak + calendar
  compute trained-day membership in the user's local timezone — pass completion
  instants (epoch ms) to a client component, bucket by local date there, same
  pattern as `page.tsx`'s `recentCompletedAtTimes`.
- **Units**: weights are kg canonical; convert at display via `lib/units.ts` +
  `getWeightUnit`, exactly like Program Stats and the detail page.
- **Viz**: inline SVG sparkline + bars, no dependency — Program Stats
  (`programs/[id]/stats`) is the precedent to match.
- **Records cache (optional, Phase 5)**: an all-time records read can run live
  off `sets`; only if the query is too heavy do we add a `personal_records`
  table updated on `saveWorkout`. Default: compute live, measure, add the table
  only if needed — keep the migration count at zero for the MVP.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Custom/wger id collision on the history page | M | Key every query + route on the `(source, id)` composite from day one |
| Bodyweight-lift e1RM uses *current* BW for old sets | M | Documented approximation; matches existing badge; BW snapshots out of scope |
| Timezone/DST bugs in streak bucketing | M | Bucket client-side in local tz; test around midnight + DST like the gate |
| Live badge spam (a badge per set) | M | Badge fires once per exercise-per-session on best-set improvement, not per set |
| All-time records query cost as history grows | L | Compute live first; add `personal_records` cache table only if measured slow |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently
  DEPENDS: phases that must complete first
  PRP: link to generated plan file once created
-->

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Records lib (extract) | `src/lib/records.ts`: move best-set/PR detection out of `workout/[id]/page.tsx`, keyed on `(source,id)`; detail page consumes it; behavior-preserving + tests | complete | - | - | - |
| 2 | Global exercise history | `/exercises/[source]/[id]` page + `src/db/exercise-history.ts` per-session aggregate; e1RM sparkline, last-time, session list; entry links | pending | with 3 | 1 | - |
| 3 | Streak + calendar | Home-screen streak count + local-day month heatmap; client bucket component over completion instants | pending | with 2 | - | - |
| 4 | Live PR badge | Logger fires volt badge + haptic on a PR set completion via `lib/records.ts`; reduced-motion fallback | pending | - | 1 | - |
| 5 | Records surface | Per-exercise all-time records (e1RM/heaviest/reps/volume) on the history page; optional cache table if measured slow | pending | - | 1, 2 | - |
| 6 | MCP read tools | `get_exercise_history` / `get_records` per `read-tools.ts` pattern (open question → default yes) | pending | - | 1, 2 | - |

### Phase Details

**Phase 1: Records lib (extract)** — *keystone, do first*
- **Goal**: One tested module owning "is this a PR / what's the best set,"
  keyed on the `(source, wgerExerciseId)` composite.
- **Scope**: Lift the `workout/[id]/page.tsx` detection verbatim; add
  composite-key handling; repoint the detail page at it (no visible change);
  unit tests covering e1rm PR, rep PR, mixed-kind no-badge, badge-once,
  bodyweight load, custom/wger disambiguation.
- **Success signal**: Detail-page PR badges unchanged; new tests green; no
  detection logic left inline.

**Phase 2: Global exercise history**
- **Goal**: The core review surface — one lift's arc.
- **Scope**: `src/db/exercise-history.ts` per-session best-set aggregate for a
  `(source, id)`; `/exercises/[source]/[id]` server page with inline SVG e1RM
  sparkline, "last time" header, reverse-chron session list; make exercise
  names tappable from logger last-time, workout detail, and program views.
- **Success signal**: A real lift shows its trend + last-time + sessions;
  custom and wger exercises with equal numeric ids never mix.

**Phase 3: Streak + calendar**
- **Goal**: Consistency at a glance on open.
- **Scope**: Client component bucketing completion instants into local days;
  current-streak count (active session keeps today alive); month grid with
  trained days in volt, today highlighted; reduced-motion safe.
- **Success signal**: Streak + calendar match the wall clock around midnight
  and across a DST boundary in tests.

**Phase 4: Live PR badge**
- **Goal**: PR seen at the moment of truth.
- **Scope**: On set completion in the logger, evaluate the exercise's best set
  vs. prior best (via `lib/records.ts`) and render a volt "PR" badge once per
  exercise-per-session; haptic pulse with a `prefers-reduced-motion` fallback
  (badge, no pulse).
- **Success signal**: Completing a set that beats a prior best badges live; a
  non-PR set never badges; no per-set spam.

**Phase 5: Records surface**
- **Goal**: Collectible all-time bests.
- **Scope**: Per-exercise records block on the history page — best e1RM,
  heaviest weight, best reps, best single-session volume, each with the date it
  was set. Compute live; add a `personal_records` cache table only if measured
  slow.
- **Success signal**: Records match a hand calculation over seeded history.

**Phase 6: MCP read tools**
- **Goal**: Claude can answer "what's my bench PR / trend?"
- **Scope**: `get_exercise_history` + `get_records` read tools wrapping the
  Phase 2/5 aggregates, unit-aware, registered + tested per `read-tools.ts`.
- **Success signal**: Tools return the numbers the UI shows.

### Parallelism Notes

Phase 1 is the keystone — everything PR-shaped waits on it, but Phase 3
(streak/calendar) shares nothing with it and can run fully in parallel. Phases
2 and 3 are disjoint surfaces and run concurrently. Phases 4–6 layer on the
Phase-1/2 foundations.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| PR detection | Extract existing logic to shared lib, don't rewrite | Fresh detector | The inline logic is already careful & correct; DRY + reuse |
| Exercise identity | Route + queries on `(source, id)` composite | Key on `wgerExerciseId` like the badge does today | Avoids custom/wger id collision on a per-exercise page |
| Streak/calendar tz | Client-side local-day bucketing | Server-side "today" | Codebase already learned this via `TrainedTodayGate` |
| Viz | Inline SVG, no chart lib | Recharts/etc. | POC bundle discipline; matches Program Stats |
| Records storage | Compute live, cache table only if slow | Eager `personal_records` table from day one | Zero-migration MVP; add cost only when measured |
| Live badge axes | Mirror existing badge (e1rm + rep PR), once per exercise | Every axis every set | Payoff without badge spam |

---

## Research Summary

**Market Context**
Per-exercise history, streaks, and PR badges are table stakes in Strong/Hevy —
but they're global-only and rarely gym-aware. This app's differentiator (per
*program* stats) already exists; this PRD fills the expected *global* half so
the two lenses coexist: program = gym-clean block view, global = all-time arc.
(Prior product knowledge; framing only, not re-verified.)

**Technical Context**
Everything needed is in place: detection (`workout/[id]/page.tsx` +
`lib/one-rep-max.ts`), history corpus (`db/workouts.ts`
`getExerciseHistoryBefore`/`getLastPerformance`), unit handling
(`lib/units.ts`), local-day pattern (`TrainedTodayGate`, `page.tsx`
`recentCompletedAtTimes`), viz idiom (`programs/[id]/stats`), and the MCP
read-tool pattern (`lib/mcp/read-tools.ts`). The one structural correctness
item is the `(source, wgerExerciseId)` composite identity, which the existing
badge sidesteps but a per-exercise page cannot.

---

*Generated: 2026-07-13*
*Status: DRAFT - needs validation*
