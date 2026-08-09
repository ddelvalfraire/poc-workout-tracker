# Progression Test Harness — layered, extensible, proven

## Problem Statement

The engine (progression + autoregulate + plan-sync) is guarded by 2,607 mostly example-based tests. Examples prove the cases someone thought of; two adversarial gauntlets proved that the defects live in the interactions nobody thought of. There is no mechanism that proves the engine's *laws* hold across the input space, no artifact that shows an engine change's training-outcome consequences in review, and no measure of whether the suite itself would catch a subtle regression.

## Evidence

- Adversarial review 2026-08-08: 13 findings + 1 verification re-break, nearly all multi-session interactions (streak cascades, positional drift, window pollution) — the class example tests structurally miss.
- The engine already states its laws in prose: the H1–H6/C1–C2/M1–M4 docblock vocabulary in autoregulate.ts, the precedence law in progression.ts, plan-sync's shared-evidence contract. None are mechanized.
- Research (2026-08-09, session record): metamorphic + property-based testing is the standard proof technique for oracle-less rules engines (trading/risk, schedulers, tax, compilers); fast-check's model-based mode maps directly onto AutoregSession windows; Stryker measures suite quality. No fitness-domain prior art exists (Liftosaur tests a DSL interpreter — different shape).

## Approved Architecture (user-approved 2026-08-09)

- **Layer 0 — canonical examples**: one documentation test per named heuristic (H/C/M codes); prune combinatorial duplicates as Layers 2–3 subsume them.
- **Layer 1 — invariant registry** (build first): a test-only module of named predicates extracted verbatim from the docblocks (`precedenceHolds`, `streakResetsOnLoadChange`, `quorumGatesVerdict`, `evidenceIsLoadKeyed`, `mixedTopBucketNeverSteps`, `waveArithmeticNeverDrifts`, plan-sync shared-evidence, …). Single source; Layers 2–3 cite invariants by name.
- **Layer 2 — property/model-based (fast-check + @fast-check/vitest)**: per-scheme arbitraries composed with `fc.oneof` (scheme #8 = one new arm); stateless properties over deriveWeekSets/applyOverride; **model-based** properties over autoregulate windows (commands = evidence classes, model = expected streak/quorum). Cheap differential checks: closed-form wave/volume math vs naive loops. Seeded, deterministic, generated timestamps only.
- **Layer 3 — golden corpus (USER DECISION: create our own, research-grounded)**: hand-curated block trajectories where **published program canon is the oracle** — 5/3/1's own cycle tables (Wendler), GZCLP's published stall ladders, Stronglifts' deload rules — each corpus entry cites its source; plus reproductions of every gauntlet finding and representative multi-scheme program shapes. Snapshots include the lifter-facing reason strings. Corpus additions require the citation; snapshot diffs require a prose "why" or the PR blocks.
- **Layer 4 — Stryker mutation gate**: incremental, scoped to progression/autoregulate/plan-sync; PR-blocking on score REGRESSION only; full run nightly. Baseline measured at first run (open question resolved empirically).

## Extensibility rules (locked)
1. Scenarios/properties import only the public surface — never private helpers.
2. One arbitrary per domain type; new schemes extend generators, never rewrite tests.
3. Invariants defined once in the registry; cited by name everywhere.
4. Golden files reviewed as domain output with citations, not as diffs.
5. Window/threshold constants imported from the engine, never hardcoded.
6. New rules ship their invariants in the same PR.
7. No wall-clock reads anywhere in the harness.

## What We're NOT Building
- Gherkin/Cucumber (typed builders + registry citations beat string indirection).
- A differential re-implementation (except the 2–3 closed-form-vs-loop spots).
- zod-fast-check derivation, coverage-guided PBT (no mature TS tooling).
- 100%-mutation-score gates (fights silence-over-corruption by construction).
- Broad snapshot coverage (PBT owns breadth; the corpus is curated, cited depth).

## Mutation ratchet

Layer 4 is live. Stryker mutates only the three engine files (`src/lib/progression.ts`, `src/lib/autoregulate.ts`, `src/lib/plan-sync.ts`) and runs only the engine suites (the three co-located `.test.ts` files + `src/lib/testing/**`) via `vitest.stryker.config.ts`.

- **Baseline (measured 2026-08-09, StrykerJS 9.6.1 / Vitest 4.1)**: **86.22%** — 1,459 mutants: 1,145 killed + 113 timeout, 187 survived, 14 no-coverage, 0 errors. Per file: progression 93.90%, autoregulate 84.53%, plan-sync 76.81%.
- **Runtime**: full cold run ~7m30s local (10 workers); incremental reruns (`.stryker-incremental.json`, gitignored) re-test only mutants whose code or tests changed — a no-change rerun takes ~5s.
- **Commands**: `npm run test:mutation` (plain Stryker run), `npm run test:mutation:check` (runs Stryker, then fails if the score drops below `stryker-baseline.json` minus 0.5pp tolerance — `scripts/mutation-check.mjs`).
- **Ratchet policy (raise-only)**: the gate blocks REGRESSION only — never an absolute threshold (a 100% gate fights silence-over-corruption by construction; see "What We're NOT Building"). When the score improves past baseline + tolerance, bump `mutationScore` in `stryker-baseline.json` in the same PR. Never lower it to make a run pass.
- **Survived-mutant workflow**: a survived mutant is a COVERAGE GAP lead, not an emergency. Periodically (or when touching an engine file) open the JSON report (`reports/mutation/mutation.json`, gitignored), pick survivors in the code you own, and either (a) add a test that kills it — usually a Layer 0 example or a Layer 1 invariant cite — or (b) note why it's unkillable (equivalent mutant). Known lead clusters from the baseline run: plan-sync's evidence-set filter and `Math.min` candidate-load choice (~lines 148–158), autoregulate's `LOAD_EPSILON_KG` boundary/tie-break in `evidenceLoadFor`/`anchorLoadFor` (~260–284), progression's null-reps filtering in `hitTopOfRange` (~170).
- **Cadence**: quick/incremental check per PR touching the engine; full cold run nightly (delete `.stryker-incremental.json` to force cold). No CI workflow exists in-repo yet; the npm scripts are the interface.

## Success Metrics
| Metric | Target |
|---|---|
| Invariant registry | Every H/C/M docblock code has a named, executed predicate |
| Property coverage | All 7 schemes generated; autoreg window model runs command sequences |
| Corpus | Every published-canon entry cites its source; every gauntlet finding reproduced |
| Regression loop | A failing PBT seed becomes a pinned test the same day (process, spot-checked) |
| Mutation | Baseline recorded; CI blocks regression below it |
| CI budget | Added blocking-suite time ≤ ~30s; deep sweeps nightly |
