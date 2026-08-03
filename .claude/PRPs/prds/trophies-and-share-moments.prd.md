# Trophies & Share Moments — fact-derived milestones + the distribution loop

## Problem Statement

Crews are dead ("dont need crews right now or in the future") — the social
layer becomes shareable MOMENTS. The app generates brag-worthy facts (PRs,
streaks, blocks) but has no milestone system (badges were deliberately cut
in the goals arc — superseded at the user's direction: "did we finish
trophies?" / "yep sounds good") and no way to distribute a moment outside
the app. Three pieces, built in order: trophies (generate moments), share
cards (make them postable), workout share links (make sessions viewable).

## Piece 1 — Trophies (fact-derived only; honesty brand holds)

Never awarded for engagement fluff. Kinds, all computable from existing
facts:
- **Plate clubs** (best e1RM per canonical lift, lb-defined per lifting
  culture, stored kg): Bench 135/225/315, Squat 225/315/405, Deadlift
  225/315/405/495, OHP 135/225. Canonical lifts matched by a curated
  wger-id set (+ name fallback for customs) — documented map.
- **1,000 lb club**: squat+bench+deadlift best e1RMs sum ≥ 453.6 kg.
- **Workout counts**: 1, 50, 100, 250, 500 completed.
- **Streak milestones**: 4, 12, 26, 52 consecutive scheduled weeks (the
  goals streak engine, grace-respecting).
- **Block complete**: first program block fully trained.
- **Lifetime tonnage**: 1M lb / 2M lb (Σ completed reps×weight).

Mechanics:
- `trophies` table: id, userId, kind text, achievedAt, context jsonb (the
  fact: lift, value, workoutId when relevant), UNIQUE (userId, kind) —
  stamped once, the goals achievedAt idempotency pattern.
- Detection rides the existing post-finish seam (fails soft) + the import
  path. **Retroactive rule**: stamps triggered by anything other than the
  just-finished workout (e.g. a history import) record quietly — trophy
  page only; NO push, NO celebration flood. Only a live finish celebrates
  + pushes ("Trophy: 315 Squat Club").
- Surfaces: /trophies (earned grid + locked-with-progress hints, e.g.
  "285/315 — 30 lb to go"), workout-complete celebration block, one push
  ever per trophy. Streak flame/goals untouched.

## Piece 2 — Share cards (OG images)

Server-rendered share-card image route (Next ImageResponse — zero deps)
for: a trophy, a PR (exercise + new e1RM), an e1RM trend ("Squat 315 → 340
in 8 weeks"). Branded, dark, volt; user's unit. Reached from a Share action
on trophy/PR/exercise-stats surfaces → navigator.share with clipboard
fallback. **No body data, ever** — strength progress only (the photos hard
rule stands; body sharing would be a separate deliberate design).

## Piece 3 — Workout share links

`workout_shares` mirroring program_shares (token, revokedAt, cascade).
/w/[token] Clerk-public self-gating page: read-only summary — exercises,
sets, PR badges, duration, volume, date. NEVER notes (may contain private
context — decided: notes stay off the public surface), never body data, no
adopt flow. authz: `Workout` resource joins the CASL module ('view' via
live share; 'manage' owner-only) — new rules in the one module, the seam
promise kept. Share action on the workout summary; revocable.

## What We're NOT Building

Crews/memberships (dead per user), XP/levels/points, engagement badges
(login streaks, app-opens), body-progress sharing, comments/likes, share
analytics.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Honest trophies | Every kind maps to a lifting fact; import floods never push | detection tests incl. retroactive rule |
| One celebration | A trophy celebrates + pushes exactly once | idempotency tests |
| Postable | Trophy/PR/trend cards render as images sharable via the OS sheet | manual + route tests |
| Private by default | Workout pages resolve only via live tokens; notes never render publicly | authz extension + page tests |

## Open Questions

- [ ] OHP canonical-id set overlaps seated variants — curate in build.
- [ ] Card dimensions: 1200×630 OG-only v1 (square IG variant later).
