# SPIKE — Home Page Redesign

Design exploration (2026-08-03), NO implementation. Trigger: after the nav
drawer shipped (#143), "the home page still needs the same glow up. lets
take the same research ui ux steps we did for the side nav."

## 1. The problem, precisely

Post-drawer home is a stack with no hierarchy beyond the hero:

| Slot | Today | The problem |
|---|---|---|
| Resume banner | volt card when session live | fine — earns its weight |
| Hero | NextWorkoutCard, gated by TrainedTodayGate | VANISHES after training — home's biggest moment (you just trained) renders as… nothing where the hero was |
| Check-in card | when due | fine |
| Goals teaser | quiet row: label + chevron | identical grammar ↓ |
| This-week teaser | quiet row: label + chevron | identical grammar ↓ |
| Today workouts | small list | third list on one screen |
| Unfinished | list | fine (quiet by design) |
| History | full list, unbounded | dominates 70% of scroll; a LOG, not a status |

Three defects: (a) three consecutive surfaces share one uniform quiet-card
grammar — the "flat list of boring components" disease the drawer just
cured; (b) the trained-today state — the app's daily emotional peak — is
expressed as an ABSENCE (gate removes the hero, teaser soup floats up);
(c) history is tier-3 data occupying tier-1 real estate.

## 2. Research findings

- **Gentler Streak** (ADA winner): the top of the home tab is a STATUS —
  data digested into words + an illustration, "a love letter from your
  heart." Big bold numbers below. The app's celebrated move: it doesn't
  show you data, it tells you where you stand.
- **Athlytic**: opens with a WRITTEN SUMMARY of the day ahead that
  UPDATES AS THE DAY PROGRESSES — morning it prescribes, evening it
  recaps. Panels below carry scores.
- **WHOOP** (925studios breakdown): three-tier progressive disclosure —
  overview shows THREE NUMBERS ONLY (one at ~72pt, arm's-length legible);
  trends and raw data live one tap deeper, never on the overview. A
  deliberately narrow color vocabulary (3 colors, fixed meanings)
  repeats everywhere so color reads as language.
- Carrying over from the nav research (Arc, Mobbin): zones with distinct
  jobs, scale rhythm through contrast, empty states as invitations.

## 3. THE DIRECTION — "home is your training status, not a menu of teasers"

The drawer answers "where can I go"; home answers "where do I stand,
right now" — in words, with one big number, Gentler-Streak-style. The
status NEVER vanishes; it CHANGES.

```
┌──────────────────────────────────┐
│ ☰  WORKOUT TRACKER      ⚙  face │
│                                  │
│  LEGS DAY.                       │ ← STATUS zone: font-display
│  Week 3 of 7 · last time you     │   editorial line + one-sentence
│  hit 225×5 on squats             │   context; states below
│  ┌────────────────────────────┐  │
│  │ ▶ START LEGS · WEEK 3      │  │ ← CTA lives INSIDE the status
│  └────────────────────────────┘  │
│                                  │
│  THIS WEEK                       │ ← MOMENTUM panel (one designed
│  42        ▂▅▃▇▂▁▁   🔥 6 wks   │   surface, replaces 2 teaser rows)
│  sets      Squat 315 · 87% ▓▓▓░ │   big number = the WHOOP number
│                                  │
│  TODAY                           │ ← only when something happened
│  ✓ Push · 52 min · 8,076 lb     │   today: recap card w/ PR chips
│                                  │
│  Unfinished (unchanged)          │
│                                  │
│  HISTORY            All history →│ ← capped at 5, demoted; full
│  [compact rows ×5]               │   log moves to /history
└──────────────────────────────────┘
```

### The STATUS zone — states, not gating

One component, always rendered, digesting state into an editorial
headline (the Gentler Streak move) + context sentence + the CTA:

| State | Headline (font-display, huge) | Context line | CTA |
|---|---|---|---|
| Session live | "IN THE MIDDLE OF IT." | {name} · {n} sets logged | RESUME (volt) |
| Program day due | "{DAY} DAY." | Week {n} of {m} · last-time fact | START (volt) |
| Trained today | "DONE FOR TODAY." | {name} · {volume} · {PR count ∥ "showed up — that counts"} | quiet "log more" |
| Rest day (program, none due today) | "REST DAY." | next: {day} · {weekday} | quiet |
| Drifting (no session in N days) | "{N} DAYS SINCE LEGS." | streak-at-risk fact if any | START (volt) |
| Fresh (no program) | "DAY ONE." | invitation copy | START WORKOUT (volt) |

This replaces NextWorkoutCard + TrainedTodayGate-as-remover + the
fresh-state CTA + ProgramReminderCard's job (its copy folds into the
fresh/no-program context line). ResumeSessionCard folds in as the
session-live state. Trained-today remains a LOCAL-day question → the
fork between "due" and "done today" stays client-side (same gate
mechanism, now choosing between states instead of removing a card).

### The MOMENTUM panel — one surface, not two rows

Goals teaser + this-week teaser merge into one designed panel: the week's
set count as the oversized number (WHOOP's one-big-number), 7-day
sparkbar (drawer's `bucketDaySets` reused), top-goal progress bar +
streak flame (StreakChip reused). Panel links to /stats; the goal line
to /goals. Empty state = invitation ("Set your first target"), never
absent — the drawer rule.

### TODAY recap — celebration, not a list row

TodayWorkouts' job absorbed: when today has completed sessions, a recap
card (name · duration · volume · PR/trophy chips when the session earned
any) linking to the summary. The daily peak gets designed weight instead
of a 3-row list.

### HISTORY demoted — WHOOP tier discipline

Home shows the last 5 compact rows + "All history →" to a new /history
page (full current list with calendar anchors and Repeat buttons — the
code moves mostly intact; /history is a sub-page: back chevron, no
drawer trigger). Unfinished stays as-is above it.

### Color + type discipline

Volt = action + achievement ONLY (CTA, PR chips, streak flame) — the
narrow-vocabulary rule. Status headline in font-display caps, the app's
existing editorial voice (matches the logger's "DONE" card). No new
colors, no new fonts.

## 4. Deliberately NOT doing

Readiness/recovery scores (no biometrics — don't cosplay WHOOP), an
illustration/mascot (Gentler's move, not ours; our voice is the words),
horizontal carousels, pull-to-refresh, reordering, any new nav (drawer
owns it), infinite scroll on /history v1 (existing list moves as-is).

## 5. Data cost

Zero new queries for STATUS/MOMENTUM (all facts already in home's
existing Promise.all; the last-time fact comes from summaries already in
memory, or is dropped if not cheaply derivable). TODAY recap's PR chips:
PR facts aren't on the summary read today — v1 ships
name/duration/volume from existing data; chips added only if a cheap
read exists (investigate at build; no expensive scans on home).

## 6. Open questions

- [ ] Q1: /history as a new page vs. the full list staying on home —
  lean new page (the WHOOP tier discipline is the whole point).
- [ ] Q2: Drifting-state threshold — lean: streak-at-risk fact when a
  consistency goal exists; otherwise a neutral "N days since last
  session" after 4+ days. Never guilt-toned.
- [ ] Q3: headline copy set — ship the table above as v1, tune later?

## Sources
- https://www.sketch.com/blog/gentler-streak/ (status-in-words philosophy)
- https://pixso.net/articles/gentler/ (home = daily status + big numbers)
- https://www.925studios.co/blog/whoop-design-breakdown (three-tier
  disclosure, one 72pt number, narrow color vocabulary)
- https://the5krunner.com/2023/03/28/new-whoop-home-screen-looks-pretty-but-is-it-as-intuitive/
- https://www.athlyticapp.com/news (written day summary that updates)
- 2026 ADA finalists (The Outsiders readiness viz) — carried from
  navigation.spike.md sources
