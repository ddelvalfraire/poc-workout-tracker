# Initial Load Selection

Per-program (with per-exercise override) policy for how the first working weights of a program are chosen — from history carry-forward and entered maxes through guided find-your-weight sessions and dedicated calibration/test weeks. Configurable, options-maximal, grounded in what the derivation engine already does.

- Status: draft / research-verified / no implementation
- Date: 2026-08-20

## 01 · Product framing

Today week-1 loads are either author-typed (`suggestedLoadKg`, `trainingMaxKg`) or blank-until-performed: the lifter logs a weight with no ghost, and autoregulation anchors off it from week 2 (`nullLoadAnchor()` in `src/lib/programs/autoregulate.ts`). The one computed seed in the codebase is the TM prefill on the program **edit** page — `e1RM × 0.85` via `seedTrainingMax()` (`src/app/programs/new/program-draft.ts`) — a one-shot client draft heuristic, not a stored policy, absent from program create.

This spec makes initial-load selection a **stored, per-program policy**: an ordered fallback chain of strategies, resolved per exercise at derivation time. Every strategy observed in production apps and established methodologies (RP, JuggernautAI, Boostcamp, 5/3/1, GZCLP, StrongLifts/Starting Strength, RTS, Fitbod, TrainHeroic) is expressible; the default resolves byte-identical to today's behavior.

> **Design position.** The policy changes *what gets seeded into a prescription* at derive time. It never touches the snapshot mechanism (`sets.prescribed*` stay immutable facts), never leaks into the Prev chip (ghost = plan, Prev = history, never mixed), and a null policy derives exactly as today — the same three standing laws `deloadPolicy` honors.

## 02 · Strategy catalog

Industry provenance, condensed. Strategies are not mutually exclusive; real programs need "carry forward if you've done this exercise, otherwise ask for a max, otherwise find your weight" — hence a chain, not a single value.

| Strategy | Mechanism | Input | Provenance |
|---|---|---|---|
| `authored` | Use `suggestedLoadKg` / `trainingMaxKg` as written | none | StrongLifts/SS fixed starts; today's behavior |
| `carry-forward` | Seed from same-exercise history (last performance, best recent, or rolling e1RM), optional bump %, staleness decay | history | RP cross-meso (~+5%, secondary reporting), Hevy routine-scoped Prev, StrongLifts break deload |
| `percent-e1rm` | `e1RM × fraction`, generalizing the TM prefill to every scheme | history | RTS, Fitbod |
| `entered-max` | Adoption-time interview: 1RM or rep-max (converted via Epley) × haircut 0.85–0.90 | one number per lift | 5/3/1, nSuns, Boostcamp, TrainHeroic, GZCLP (5RM fan-out) |
| `rir-anchor` | Explicit find-your-weight under a RIR target, optionally with an RP-style guided warm-up ramp (~30RM×12 → ~20RM×8 → ~10RM×4) | none | RP Hypertrophy (primary source: RP help article 30803792842775) |
| `calibration` | Dedicated test session/week: AMRAP at submax, ramp-to-top-set, or RM test; result feeds the TM/base | one session | Starting Strength ramp, Madcow, RTS work-up, 5/3/1 "+" sets |
| `demographic-seed` | Strength-standards table by bodyweight/sex/experience, seeded conservative | bodyweight + level | Fitbod population data, StrengthLevel, Symmetric Strength |

Cross-cutting rules every source independently converges on:

- **Bias conservative.** Wendler's 10–15% TM haircut, Fitbod's low seeding, GZCLP's warnings. A too-light week 1 costs a week; a too-heavy one costs the program.
- **e1RM only from low-rep sets.** Epley/Brzycki diverge 10%+ beyond ~10 reps. `rollingE1rm`'s current 12-rep cutoff is slightly generous; seeding uses ≤10.
- **Quantize to the gym.** Every seed passes `quantizeLoadKg`. Percent math on machine stacks is why `rir-anchor` stays the machine-and-dumbbell default.
- **Pinned vs auto.** A user-entered max is pinned — never silently auto-adjusted until re-tested or re-entered (TrainHeroic's working-max rule). An auto-derived max keeps tracking.
- **Decay stale history.** Carry-forward past a staleness window applies a discount, mirroring the deload-after-break behavior lifters expect.

## 03 · Data model

Follows the `deloadPolicy` / `overshootPolicy` pattern exactly: nullable JSONB on `programs`, optional per-exercise override, zod discriminated union in `src/lib/programs/program-input.ts`, pure resolver in `src/lib/programs/progression.ts`.

```ts
// programs.initial_load_policy   jsonb, nullable — null resolves to today's behavior
// program_exercises.initial_load_policy — optional override (overshootPolicy pattern)

type InitialLoadPolicy = {
  chain: InitialLoadStrategy[]   // first strategy that produces a number wins
}

type InitialLoadStrategy =
  | { mode: 'authored' }
  | { mode: 'carry-forward'
      source: 'last-performance' | 'best-recent' | 'rolling-e1rm'
      bumpPercent?: number
      staleAfterDays?: number
      staleDiscountPercent?: number }
  | { mode: 'percent-e1rm', fraction: number }
  | { mode: 'entered-max', haircut: number, allowRepMaxEntry: boolean }
  | { mode: 'calibration'
      protocol: 'amrap' | 'ramp-top-set' | 'rm-test'
      targetReps?: number }
  | { mode: 'rir-anchor', guidedRamp?: boolean }
  | { mode: 'demographic-seed', percentile: 'untrained' | 'novice' }
```

- **No row / null = unassigned**, resolving to the implicit legacy chain `['authored', 'rir-anchor']` — byte-identical derivation for every existing program.
- **Pinned maxes get storage.** The draft-level `trainingMaxFromE1rm` flag is promoted to a persisted `origin: 'entered' | 'derived' | 'calibrated'` alongside the TM, so the pinned-vs-auto rule is enforceable at the db layer, not the UI layer.
- Terminal `rir-anchor` / missing-input chains yield `loadKg: null` — exactly today's blank, feeding the existing anchor mechanism.

## 04 · Calibration / test-week infrastructure

Committed scope, not a later phase. Calibration is the highest-quality strategy per unit of friction, the natural post-layoff reset, and the only honest way to serve `entered-max` users whose numbers are stale.

- **Calibration prescription.** When the chain resolves to `calibration` and no calibration result exists for the exercise, the derivation emits a *calibration variant* of the day's sets for that exercise instead of the scheme's normal sets: `amrap` (one submax AMRAP set at a policy-defined estimate or entered guess), `ramp-top-set` (ascending sets of `targetReps` until the lifter stops — SS-style), or `rm-test` (work up to a `targetReps`RM). This reuses the existing per-week shape machinery: derivation already varies a week's sets by position (deload shaping); calibration is another shape, keyed by "no result yet" rather than week index.
- **Result capture.** The calibration session is a normal logged workout — sets are facts like any others. The *result* (derived e1RM from the top/AMRAP set, via `estimate1RM` on ≤10-rep sets) is computed at completion and stored as the exercise's calibrated max with `origin: 'calibrated'`. No new logging surface; the logger just labels the calibration sets as such.
- **Week-0 vs in-week.** A program may declare a dedicated test week (all calibration-mode exercises calibrate in week 1, scheme weeks shift by one) or calibrate inline (first session per exercise is the calibration shape, remaining sessions that week derive from the fresh result). Inline is the default — RP's ramp proves calibration can live inside the first regular session; the dedicated week is for programs whose authors want it (Madcow-style).
- **Recalibration triggers.** Re-entering `calibration` mode happens when: the lifter explicitly requests it, carry-forward staleness exceeds the window, or a pinned max is older than a policy threshold. Deload/tmBump machinery is untouched — calibration feeds the same TM the existing `tmBumpTiming` stamps already govern.

## 05 · Derivation integration

All located seams; no new query patterns.

1. **Resolver** — `resolveInitialLoadPolicy()` in `src/lib/programs/progression.ts` beside `resolveDeloadPolicy`; per-exercise override beats program beats legacy default. Threaded through `DayForDerivation.program` (`src/db/programs.ts`).
2. **Seeding point** — the `base === null` branches of `schemeLoad()` (`src/lib/programs/progression.ts:235`): when week 1 has no base, run the chain instead of returning `{loadKg: null}`. History inputs reuse the already-batched `getExerciseHistoryBefore` / `rollingE1rm` / `bestSet` reads inside `deriveDayPrescription()`.
3. **Calibration shape** — emitted from `deriveDayPrescription()` when §04 applies, before quantization and snapshotting, so instantiation, `preview_program_week`, and logger ghosts all agree for free.
4. **Quantization** — every computed seed passes `quantizeLoadKg` before surfacing.

## 06 · Authoring & adoption UI

- **Program builder** (`src/app/programs/new/program-builder.tsx`): a policy control alongside the existing TM field; per-exercise override where `overshootPolicy`'s override lives.
- **Patch tool** (`src/db/program-patches.ts`): a `set_initial_load_policy` op so MCP-authored programs and proposals can set it; flows through the standard proposal/forced-owner-confirm path.
- **Adoption interview** — `entered-max` needs a UI moment at program create/adopt (today's TM prefill exists only on edit). Generalize `seedTrainingMax()`: prefill from e1RM where history exists, ask where it doesn't, with a rep-max→e1RM converter built once and reused everywhere a max is requested.

## 07 · Display contract

- A seeded weight is a plan target: it renders through `planSetGhost()` only, never the Prev chip.
- A `rir-anchor` week 1 is explained ("pick a weight you can leave ~3 in the tank with"), not an unexplained blank; with `guidedRamp`, the RP ramp renders as warm-up guidance above the working sets.
- Calibration sets are visibly labeled as calibration in the logger; the computed result is surfaced at session completion ("Bench calibrated: e1RM ~92.5 kg").
- Non-`weight_reps` logging types keep their existing ghost rules (`planSetGhost` strips weight for bodyweight-relative types); seeding only ever targets types where a total or added load is meaningful.

## 08 · Validation rules

- Chain must be non-empty; `authored` and `rir-anchor` are always-terminal (they cannot fail), so a chain containing one of them earlier than last makes later entries unreachable → validation error.
- `percent-e1rm.fraction` and `entered-max.haircut` bounded to (0, 1]; `bumpPercent` / `staleDiscountPercent` bounded to sane ranges.
- `calibration` on a non-load-bearing logging type (`bodyweight_reps`) → validation error except `amrap` (rep AMRAP is meaningful).
- `demographic-seed` requires a bodyweight on file at resolve time; absent → strategy is skipped (chain falls through), never guessed.

## 09 · Out of scope & open questions

### Out of scope (v1)

- Velocity-based calibration (hardware-dependent; the `calibration` protocol union is the seam if ever wanted).
- Substitution-similarity carry (bench → incline at a discount) — carry-forward is exact-exercise-match only; substitutes fall through the chain.
- `demographic-seed` shipping data: the strategy is specced and validated, but the standards dataset selection/licensing is its own task.

### Open questions

- **Author-time vs derive-time seeding.** Spec position: derive-time (personalizes one program per lifter, consistent with anchor schemes). Confirm before implementation.
- **Where the adoption interview lives** — program adopt/create flow vs first-session start.
- **Exact staleness defaults** (`staleAfterDays`, discount %) — mechanism is the spec; the integers are a tuning pass, same stance as muscle-roles bands.
- **RP's ~+5% cross-meso bump** is secondary reporting; our `bumpPercent` default should be chosen from our own data, not copied.
