# SPIKE — Navigation & App Shell

Design exploration (2026-08-03), NO implementation. Trigger: "I don't have
any way to view trophies. or navigate to them or goals" → my link-tile fix
rejected ("thats a fucking anti pattern"), bottom tab bar rejected ("doesnt
work"), direction given: "you can follow the claude app sidebar but thats
about it" — and a spike demanded before any build.

## 1. The problem, precisely

The app has ~11 authed destinations and ZERO persistent navigation. Every
surface is reachable only from home's accreting button pile:

| Destination | Reached today via |
|---|---|
| / (home) | — |
| /programs (+ /programs/templates) | home tile |
| /templates | home tile |
| /exercises | home tile |
| /stats | home volume teaser card |
| /goals | home teaser — ONLY when a goal already exists (the reported bug) |
| /trophies | a link on /goals (unreachable transitively) |
| /body | Settings row |
| /coach | home header icon (coach users) |
| /settings | header gear |
| /settings/import | Settings row |

Two real defects: (a) new surfaces keep costing a home tile (4 already;
unsustainable), (b) conditional teasers double as the ONLY entry (goals
bug: no goal → no path to create one).

## 2. Options considered

- **More home tiles** — rejected by user; it's the anti-pattern: nav as
  content accretion, no hierarchy, unbounded growth.
- **Bottom tab bar** (Hevy/Strong/HIG standard) — rejected by user. Honest
  note of the real friction it had here anyway: the logger's sticky
  Finish bar and the coach composer own the bottom edge, so the bar would
  hide on the app's two most-used screens.
- **Hub pages only** (a /progress hub, no persistent nav) — solves
  grouping, not persistence; still routes everything through home.
- **Sidebar drawer (the Claude app pattern)** — DIRECTED. Scales to 11+
  destinations, steals no bottom edge, familiar anatomy, and sub-pages
  keep their back-chevron pattern untouched.

## 3. The Claude sidebar anatomy, mapped

Claude app (mobile): hamburger top-left → left drawer over a scrim; "New
chat" CTA at top; nav items; recents list; profile/settings pinned at
bottom. Desktop: persistent-collapsible — out of scope for our phone-shell
app except /ops, which keeps its own header.

Ours:

```
[ + Start workout ]        ← "New chat" analog, volt, session-guarded
———————————————
Home
Programs                   ← templates browse already lives inside
Exercises
Stats
Goals
Trophies
Body
Coach
———————————————
RECENT                     ← last 3 completed workouts → summaries
Push · Yesterday
Legs · Aug 26
———————————————
Settings          [avatar] ← pinned bottom, Claude-style
```

Grouping decision (Q1): flat list of 8 vs. sectioned ("TRAIN:
Programs/Exercises" + "PROGRESS: Stats/Goals/Trophies/Body"). Lean: flat
with hairline separators — 8 items fits one screen; sections add chrome
before they add clarity.

## 4. Mechanics (decisions to confirm)

- **Trigger**: hamburger in the header of top-level pages only; sub-pages
  (workout summary, exercise detail, program detail, …) keep back
  chevrons — exactly Claude's mobile behavior. The live logger and public
  pages (/p, /w) get NO trigger (logger owns its chrome; public pages are
  chromeless by design).
- **Dialog discipline**: reuse the native <dialog> showModal recipe the
  bottom sheets standardized (focus trap, StrictMode guard, geometric
  dismiss — flipped for a left panel) + drawer-left enter/exit keyframes
  following the sheet-up/sheet-exit + useAnimatedSheetClose precedents.
- **Start-workout guard**: the drawer is client; the single-active-session
  guard's summary is server-computed. Options: (a) small authed endpoint
  fetched on drawer open (also serves recents — one fetch per open), (b)
  thread through the root layout (costs every page the reads). Lean (a).
- **Home after the drawer**: the 2×2 grid and fresh-state link stack are
  DELETED; home keeps hero, resume/check-in/goals/reminder cards, weekly
  teaser, history. Fresh-state keeps its big "+ Start Workout" CTA.
- **Coach gating**: the Coach row renders only for coach-gated users
  (mirrors the current header icon's gating).
- **/ops**: unchanged (own desktop shell, Settings-gated entry).

## 5. Deliberately NOT doing

Desktop persistent sidebar (phone-shell app), recents search, nav
badges/counters v1 (a trophy-count dot is cheap later), reordering or
customization, bottom-tab revival.

## 6. Open questions for the user

- [ ] Q1: flat 8-item list vs. sectioned (TRAIN / PROGRESS) — lean flat.
- [ ] Q2: Recents section in v1 — lean yes (3 items; it's the anatomy's
  soul) but cuttable.
- [ ] Q3: wordmark stays in the home header, or moves into the drawer
  header like Claude? Lean: stays.
- [ ] Q4: does Quick Log deserve a drawer row distinct from + Start —
  lean no, one CTA (they're the same flow today).
