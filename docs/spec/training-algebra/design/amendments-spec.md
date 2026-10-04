# Amendment specification for the synthesis package (fold round 2)

The operative consolidation of: the three-reviewer interrogation, the six-slice corpus (corpus/corpus-summary.md), the time memo (time-model.md), and the owner-ratified decision defaults (decisions-memo.md). The fold applies ALL of this to scratchpad/arena2/synthesis/ as one verified package. Where this file conflicts with an older note, this file wins.

## A. Metric registry (the root amendment; 3-reviewer consensus + corpus)

Replace the lifting triple (reps/load:mass/effort:RIR) everywhere a set is targeted, performed, queried, issued, or resolved.

- `Metrics` registry (pattern: the existing Inputs interface + satisfies mirror): reps, load (mass), effort (RIR), duration (time), distance (length), pace (unit over time/length), hr (freq), power, rom (angle). Each entry: dimension, target shapes allowed (exact | range | atLeast | atMost | open), loggedBy (which logging types produce it), semantics tag for mass (external | assisted | bodyweight+added) so e1RM and "decrease" rules read EFFECTIVE load (owner law).
- A set target = a partial record Metric -> Bound. AMRAP = reps atLeast + open. "Run 5km" = distance exact + duration open. "Zone 2 x 40min" = duration exact + hr range. Timed sets lose the special-case RepSpec arm; a load on a duration-only exercise is refused by loggedBy, replacing the old lift/timed discriminant.
- PerformedSet, PerformedField, TargetField, EventQuery reads, IssuedTarget fields, Resolution keys: all become metric-keyed (`ev.metric(step, m, pick)` with pick last|best|worst|sum|count). hitAll/missedAny are defined per metric bound (a bound is hit when the logged value satisfies it; unlogged = unknown, not miss).
- Enum-keyed maps allowed (zones, modalities). Aggregates: `weekly(metric, by: RefKind|tag)` replaces sets-only AggQuery; technique-group volume weighting honored (0.5 per later stage, cluster 1.0, per the shipped law).
- Group scores: a day group may declare a score (time-to-complete | rounds) over its members; groups get checker rules + describers (closing the D1 hole; EMOM fixed-set-count rule enforced, scoped off for death-by via the bound).
- Xforms become metric-aware: scaleMetric(s, m, by); deload timedExercises untouched|scaled expressible; capEffort refuses on sessions without an effort metric.

## B. Program-scope policy former (plans AND outcomes)

- `Policy = { when: Expr<bool, cal|input|state-of-program>, plan?: Use<Session->Session>, outcome?: OutcomeRule }`. Week roles become predicate sugar (pos.role == deload).
- `OutcomeRule`: on commits touching StateDecl.kind 'load' in the decrease direction (effective-load terms), demote commit -> propose; optional volumeKeep companion. StateDecl gains `kind: 'load' | 'volume' | 'counter' | 'ladder' | 'stage'`.
- This hosts: the cut law (dietPhase input + demotion), reactive deload (policy whose plan swaps in the deload Use when stall state holds), readiness day-down, allocation propose-default (D4).
- Verdict math stays phase-blind; the policy is a sink-side gate (mirrors the app's applyDietPhaseToAdjustment).

## C. Replay determinism for reads

- Events carry the input facts their handlers read, snapshotted at close; Transition stamps inputsRead (like Stamp). Calendar reads evaluate against the stamped LocalDay and are stamped as calReads (time memo L12). No handler read may hit the live store.

## D. Unified facts registry

- One registry with axes: key (none|exercise|muscle|zone|...), ty, observed (standing | preSession | duringSession | postSession), freshness (maxAgeDays -> stale = silence, described), grain (instant | windowed reducer at the boundary).
- duringSession facts come from REGISTERED REDUCERS over raw series (HR trace -> avgHr, timeInZone(z), drift; bar velocity -> per-set mean velocity). The series never enters the language; reducers carry describers. Pre/post split replaces the Inputs-vs-feedback duality; `ev.feedback` becomes a postSession fact read.
- New facts from the corpus: pain (ordinal 0-10), borg (6-20, SEPARATE from RIR; cardio RPE is not 10-rir), readiness, dietPhase (enum, program-keyed scalar readable from plans), ftp, lthr, bodyweight (exists), cuffPressure, e1rm (exists).
- Prose text folds into declarations (satisfies-checked); the INPUT_TEXT fallback dies.
- Program-wide scalar reads (dietPhase) become legal from plan positions (fixes the slot-keyed-map-only hole).

## E. Typed exports + predecessor seed channel

- Programs declare `exports`: named typed terminal facts (tm(exercise), finalWorkingLoad(slot), completedFraction, finalWeek).
- A program INSTANCE may name a predecessor run; imports read its exports as Opt (absent = silence). Macro handoff becomes sugar over this; phases keep their typed handoff syntax. Checker verifies import names/types against the exporter's published decls. Abandoned predecessors export what their lifecycle state defines.

## F. Units

- Unit = one record {dimVec, scale|affine, symbol, prose}; adding a unit is genuinely one entry. New: pace dim {time:1,length:-1} with min/km / min/mi display (mm:ss formatter), bpm (freq {time:-1} with beat tagging per the cardio slice's caution), angle (deg), kcal if needed by a registry metric, km/mi notations.
- Perceived exertion: borg + cardio RPE as their own scale/dimension; asReps scoped to the e1RM library fns only.
- Fix derived-unit display in traces (derive from vector); literals may carry an explicit dimVec + display unit. TS Mul/Div tables stay as embedding sugar but the IR checker is authoritative; note the divergence in rationale.

## G. Session structure

- `repeat(n, [steps])` block former: literal-bounded, telescope scoping (performed of earlier repeats reads last iteration); work/recovery roles; recovery steps carry their own metric targets (a walk is a step, not rest).
- StepHandle reads: setIndex, repsSoFar/sumSoFar (running totals), self-reference in stepUntil targets, and `stepWhile(go, max, target(self))` (pre-tested; 5/3/1 Jokers' zero-iteration case).
- `cluster{per, intraRest}` set field (dose law correctly refuses technique-form clusters on every set).
- Technique encoding decision (D11): intensifier is canonical; new event read exposes stage outcomes (reps per stage, sum) to rules; telescope-steps encoding of rest-pause is NOT the blessed form.
- Group rest ownership: superset{between, after}; restOwnedByGroup refusal (from time memo).
- Count ranges (athlete-chosen sets): count may be a range with the floor driving volume accounting.
- Author-declared enums: Enums becomes extensible via declarations carried on the def (checker validates exhaustiveness against the decl, not a global interface).

## H. Time model (time-model.md section 3 verbatim; summary)

- Two clocks: progress (existing pos.*, advances only on training) and calendar (LocalDay stamped at the boundary; new day dimension + unit d; capability cal granted to plan/live/handler/aggregate/advanceWhen).
- One former `cal { day | occurrence | gap | recent }`; recent takes literal 1..56 days, count/sum/max of a registry metric.
- Frequency declaration sort: atLeast (tumbling expectation) | atMost (rolling cap) | minGap (spacing; state term with literal ceiling allowed, covering Mentzer/Fees). Three consumers: checker feasibility, prescribe Due verdict (immutable, soft), dayClosed reconciliation writing Adherence facts.
- Expectations issued when windows open (schedule snapshotted), misses recorded when windows close unmet; late logs append AdherenceAmendments. Matching by stamped day + Selector; workouts never move (provenance law).
- Calendar.drift: slide (default) | anchored (required by peakOn). Instance lifecycle active|paused|lapsed|completed|abandoned; paused/lapsed windows are void.
- Rotation gains pattern-with-rest-entries and daily{perDay}; ProgramDef.frequency + lapseAfterDays; periodClosed event; bounded.atMax (D12: propose is the default for criteria-gated phases); events dayClosed/skip/pause/resume/abandon; reconcile(); prescribe takes today; Assume.asScheduled; Stamp.issuedOn + calReads; ClosedFacts.localDay/occurrence/startedEarly.
- New laws L11 (progress needs training), L12 (stamped calendar reads), L13 (time alone proposes, never commits); amendments to L5/L6/L9; five new refusals; migration note (workouts.local_day backfill flagged inferred; no expectations before activation).

## Decision defaults ratified by the owner (fold these as spec)

- D2/memo-1: missed sessions are adherence facts only; never progression input by default; layoff rules are opt-in library policies reading cal.gap.
- D3: empty-session close = typed non-event; new ingest refusal emptySession; no rule fires, no streak moves; adherence may record it.
- D4: allocation outcome default propose at program scope.
- D5: custom says-templates only on library-promoted defs; user defs render generated prose with the author marker machinery removed from the default path.
- D8: canon linear is gated; import maps behavior faithfully.
- D10: budget stays 4; no div former in v1 (remove it if present; pace is a unit, ratios via ratioOf-style formers).
- D11, D12: as in G and H above.
- Memo opens, my defaults pending owner override: pauses VOID the touched window (no proration); lapse threshold 21 days, archive prompt only (never auto-archive); ad-hoc workouts count toward cal.gap (detraining is physiological) but not toward Adherence (the plan didn't ask for them); clinician "not before day N" gates render as a strong proposal-gated warning with explicit confirm, never a hard block (the app never locks the athlete out).

## Verification obligations (same bar as the graft round, extended)

1. tsc strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess clean.
2. negative.ts extended: metric-bound violations (load on duration-only exercise, hr target without the fact), cal in a forbidden position, frequency infeasibility, restOwnedByGroup, emptySession refusal twin, recursion/published-before refusal (closes EC-88), borg-is-not-rir.
3. demo runs and ships its transcript: all prior sections PLUS the new worked programs: couch-to-5k (repeat blocks, recovery steps, week-repeat on miss via state), an HR-zone tempo run (hr range target, lthr fact, pace unit prose), a pain-gated rehab scheme (pain fact, regression rule, bounded.atMax propose, time floor), a technique-bearing hypertrophy scheme (intensifier + stage event read + deload strip visible in prose), and the "legs 3x per rolling 7 days" frequency + "missed one workout last week" adherence derivation from the memo.
4. The one-entry extension PROOF: demo shows adding one metric (power) and one fact (hrv) as single registry entries, with generated prose, and prints the diff surface.
5. checker closes the free acceptances the test plan flagged where cheap: published-before/recursion, primary-muscle-exactly-one, bounded min<=max, open-phase-last, EMOM fixed count, role-policy arg typecheck. Anything not closed is listed honestly in rationale.
6. rationale.md updated in place (laws, refusals, reconciliation, cost); carry forward open questions that remain.
