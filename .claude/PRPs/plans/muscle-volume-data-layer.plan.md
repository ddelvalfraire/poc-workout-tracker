# Plan: Weekly Muscle Volume — Phase 1: Mapping + Aggregation

## Summary
Three pure/tested pieces, no UI: (1) `lib/muscle-groups.ts` — wger muscle names → 10 display buckets (grounded against the live wger muscle list; names with empty `name_en` arrive as Latin via `mapMuscleNames` fallback); (2) `lib/volume-window.ts` — rolling-7d and client-local calendar-week window math (tz offset parameter); (3) `db/muscle-volume.ts` — flat completed-sets query + pure credit aggregation (primary 1.0 / secondary 0.5, dedup, Other bucket, per-window split).

## Metadata
- **Complexity**: Medium · **Source PRD**: `.claude/PRPs/prds/weekly-muscle-volume.prd.md` (Phase 1) · **Files**: 6

## Key facts (verified in-session)
- wger muscle names as stored: Shoulders, Biceps, Hamstrings, Brachialis, Calves, Glutes, Lats, Obliquus externus abdominis, Chest, Quads, Abs, Serratus anterior, Soleus, Trapezius, Triceps (`mapMuscleNames`, wger.ts — name_en, Latin fallback).
- Catalog access: `getAllExercises()` (3-layer cache); customs: `listCustomExercises(userId)` with `muscles`/`musclesSecondary` text arrays.
- TZ convention (local-day.ts): only the client knows its day → calendar mode takes a `tzOffsetMinutes` param (Phase 2's toggle island puts `new Date().getTimezoneOffset()` in the URL); rolling mode is tz-free.
- House module style: flat query + pure exported aggregation, authz-boundary doc comment, completed-only invariant, mocked-db test harness with PgDialect introspection (exercise-stats precedent).

## Buckets
Chest←{Chest, Serratus anterior} · Back←{Lats, Trapezius} · Shoulders · Biceps←{Biceps, Brachialis} · Triceps · Quads · Hamstrings · Glutes · Calves←{Calves, Soleus} · Core←{Abs, Obliquus externus abdominis} · anything else → 'Other'.

## Tasks
1. **`lib/muscle-groups.ts`** — `MUSCLE_GROUPS` (fixed display order), `type MuscleGroup`, `muscleGroupFor(name): MuscleGroup | null`. Test pins every known wger name and the null fallthrough.
2. **`lib/volume-window.ts`** — `volumeWindows(mode, now, tzOffsetMinutes=0)` → `{ current: {start,end}, previous: {start,end} }`. Rolling: [now−7d, now) / [now−14d, now−7d). Calendar: current local week Monday-start and the one before, computed in the client-offset frame and converted back to UTC instants. Tests: fixed `now` + offsets (0, 300, −60); pure minute arithmetic (DST-agnostic, documented limitation).
3. **`db/muscle-volume.ts`** — `MuscleVolumeRow` (workoutId, startedAt, wgerExerciseId, source, metricMode); `MuscleResolver = (source, id) => { primary: string[]; secondary: string[] } | null`; pure `aggregateMuscleVolume(rows, resolver, windows)` → `{ groups: [{ group, currentSets, previousSets }] (all 10 always present, Other appended only if nonzero), totals: { currentSets, previousSets, currentSessions } }`. Credit per completed reps_weight row in a window: primary groups 1.0, secondary 0.5, a group hit by both counts once at 1.0; unknown names AND unresolvable exercises → Other. Totals count raw sets/distinct workouts (integers). `getMuscleVolume(userId, windows)` — one select (sets→workoutExercises→workouts; userId + completedAt IS NOT NULL + startedAt ≥ previous.start; completed=true), resolver built from `getAllExercises()` + `listCustomExercises(userId)`, composite identity respected (custom id ≠ wger id).
4. **Tests** — bucket map matrix; window math; aggregation: credit rule, both-listed dedup, ad-hoc rows count, duration rows excluded, window edges (start inclusive / end exclusive), Other handling, empty history, input immutability; query scoping via whereArgs.

## NOT building
UI (Phase 2), floors, trends, tonnage weighting, provenance-based mapping.

## Validation
`npm test` · eslint changed files · `npm run build`. No migration.
