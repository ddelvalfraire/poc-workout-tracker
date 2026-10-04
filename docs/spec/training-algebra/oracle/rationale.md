# Training-program algebra: a total language with named functions

> V3 + R2 (the evaluator and conformance round). The grammar is v3, frozen (47 formers; the v3 package is frozen at ../synthesis-v3/). R2 adds the running semantics: `evaluate` over all 47 formers, `step`, `prescribe`, `resolveLive`, `project` (macros included) and `exportsOf`, every FnDef example and SchemeExample run at publication, a prose-versus-evaluation differential over the whole worked corpus, property suites for L1 to L13, and a disposition of all 329 test-plan rows. "Implementation reconciliation, R2" records what runs, every law decision, every divergence found and which side was fixed, the two Consider decisions with their evidence, and what is not finished. The v3 record (S1 to S9) follows it unchanged.

## Problem

We want a typed, total, declarative language in which a training method (5/3/1, GZCLP, RP, OPT, Couch to 5K, a tendon-rehab protocol) is a definition, and the engine is a small interpreter that knows no method. Round 1 bought describability by removing arithmetic. The stress test showed where that stops, so this design takes the far end of the dial: arithmetic, aggregation, allocation, cross-scope reads and exercise-changing progressions are in. Totality comes from the shape of the calculus, describability from four structural rules.

The corpus study (116 programs) showed two more limits, fixed in round 2 at the root: a metric registry replaces the lifting triple everywhere a set is targeted or read, and a calendar clock joins the progress clock without ever mixing with it.

The language interrogation then showed that round 2 still let an author write things that read one way and ran another: a handler that punished an unlogged session as a miss, two outcomes that wrote the same field, policies that stacked while their prose described them one at a time, a rate literal that turned days into load, a swap from a squat to a plank that kept the squat's load target, a load field labelled out of reach of the cut law, exercise labels and program blurbs the author could make up, a due date the search never proved, and a late log that moved "days since your last workout" backwards. Round 3 makes each of those either a refusal or impossible to write, and shrinks the grammar while doing it (53 formers to 47).

Constraints honored from round 1: state changes only through caused, idempotent transitions; definitions are immutable versioned values; evaluation is total; absence is typed silence; issued prescriptions are facts; the one-intensifier dose law. From the owner: missed sessions are adherence facts, never progression input by default (D2); an empty finish is a typed non-event (D3); time alone never commits a state change (L13); a workout is never moved to another day (provenance).

## Usage (caller's view)

A set target is a record from metric to bound. The exercise is a registry id, and its logging type decides which metrics a target may name, so a load on a timed hold does not compile.

```ts
set({ target: { reps: range(reps(8), reps(12)), load: c.s.load, effort: rir(2) } })        // a lift
set({ target: { duration: c.s.block, pace: atMost(c.p.pace), hr: range(ofLthr(85), ofLthr(89)) } }) // a tempo run
b.repeat('intervals', 8, (r) => { r.step('run', sets(1), run(1)); r.step('walk', sets(1), walk(1.5)) }) // C25K week 1
session({ exercise: exercise('plank'), steps: (b) => b.step('w', sets(3), set({ target: { load: kg(10) } })) })
// compile error: 'load' is not assignable to Logs<'timed'>
```

A session is judged three ways, and a handler says what each verdict does. One patch carries every field with its own mode.

```ts
session: (c) =>
  byVerdict(c.ev.verdict(), {
    hit: c.commit({ load: orElse(known(c.s.load, (l) => add(l, c.p.inc)), c.ev.metric('work', 'load', 'best')), misses: num(0) }),
    missed: iff(ge(add(c.s.misses, num(1)), c.p.stalls),
                c.patch({ load: proposed(known(c.s.load, (l) => mul(l, c.p.backoff))), misses: num(0) }),
                c.commit({ misses: add(c.s.misses, num(1)) })),
    unknown: c.keep, // an unlogged set is neither hit nor miss
  })
```

Named definitions carry units and a template. A library template renders; a user definition renders its generated mechanism (D5).

```ts
export const juggernautBump = fn<{ amrap: Q<'reps'>; standard: Q<'reps'>; perRep: Q<'massPerRep'> }, Q<'mass'>>({
  id: 'lib/juggernaut-bump', version: 1, …,
  says: '{perRep} for every rep past {standard} on the AMRAP set ({amrap})',
  examples: [{ args: { amrap: reps(13), standard: reps(10), perRep: rate(2.5, 'kg', 'rep') }, gives: kg(7.5) }],
  body: (p) => mul(p.perRep, max(reps(0), sub(p.amrap, p.standard))),
})
```

State declares who may write it; what kind of field it is follows from its sort. Programs declare frequency, policies over plans and outcomes with a hit policy, per-metric grids, and typed exports.

```ts
state: { tm: ty.opt(ty.q('mass')), missed: ty.bool() },          // tm is a load field because it is a mass
writableBy: { tm: ['cycleEnd', 'owner'], missed: ['session', 'cycleEnd'] },
…
grids: { load: kg(2.5) },
frequency: () => [freq.atLeast(3, sel.muscle('quads', 'hamstrings', 'glutes'), per.week())],
policies: (c) => [policy({ when: is(orElse(c.fact('dietPhase'), tag('dietPhase', 'maintain')), tag('dietPhase', 'cut')),
                           outcome: { demote: { kinds: ['load'], direction: 'decrease' }, volumeKeep: true } })],
hitPolicy: 'allInOrder', // the default; 'first' keeps one rule per channel
```

The coach and MCP author JSON and get refusals with IR paths. The shell calls the engine with a stamped day.

```ts
checkProgram(def, publish([...library]))      // infeasibleFrequency at frequency: 4 sessions every 7 days cannot stay 2 days apart
const issued = prescribe(prog, head, 'A', facts, today)   // reconciles through today, then issues with a Due verdict
ingest(ledger, { k: 'sessionClosed', causeKey: `session:${id}`, facts })   // emptySession refused; duplicate = no-op
```

## Shape

Files, each one body of domain knowledge:
- `units.ts` holds dimensions, unit records and the canonical/display conversion.
- `registry.ts` holds the open vocabularies: scales, enums, logging types, exercises, metrics, facts, reducers, the verdict tags.
- `algebra.ts` holds sorts, capabilities, the Term IR (47 formers) and the typed embedding.
- `time.ts` holds the calendar clock: declarations, and the running reconciliation, adherence, feasibility and due-verdict slice.
- `structure.ts` holds sessions, reads, state declarations, schemes, programs, policies, exports and macros.
- `engine.ts` holds laws L1 to L13, the refusal taxonomy, issuance, events and the head, as signatures.
- `checker.ts` is the running term judgment and the typing authority; `checkdefs.ts` the definition-level rules and the publication log.
- `describe.ts` is the running term describer and traces; `describe-defs.ts` the definition, declaration and calendar-fact prose.
- `programs.ts` holds the strength and hypertrophy programs; `endurance-rehab.ts` the cardio and rehab ones.
- `evaluate.ts` is the evaluator (all 47 formers, fields, frames); `xform.ts` the eight session transformers over values; `judge.ts` the verdict and event reads; `ports.ts` how an instance's world reaches the evaluator; `issue.ts` issuance, the sink, resolution; `step.ts` activation, transitions, the ledger, `prescribe`, exports; `project.ts` projection, macros and scheme examples; `describe-run.ts` the prose of what the engine produces, and `explain`.
- `negative.ts`, `demo.ts` + `demo-eval.ts`, `demo.out.txt`, the suites (`semantics.test.ts`, `laws.test.ts`, `conformance.ts`, `differential.ts`, on `testkit.ts`), `dispose.ts` + `dispositions.ts`, and `verify.sh` are the contract.

**One typing authority.** The IR checker decides what a program means and whether it is accepted. The TypeScript embedding is a builder whose phantom sorts and capabilities are best-effort: it catches most errors at tsc time, every refusal it makes has an IR twin (TS-refused ⇒ IR-refused, negative.ts against demo §3), and every construct the IR accepts that was authored as JSON either typechecks in the embedding or is a listed gap (the converse corpus, demo §3c). The rules only the IR carries are listed in negative.ts's header.

**Units.** A dimension is an integer exponent vector over mass, rep, set, time, length, effort, week, day, angle and beat. A unit is one record: dimension, scale, compact symbol, prose. A literal stores its CANONICAL value (kg, s, m, RIR, beats/s) beside the unit it displays in, so `100 kg + 5 lb` is one canonical sum that shows both operands (trace: "102.268 kg (100 kg + 5 lb)"). RPE is input notation: `rpe(8)` lowers to 2 in reserve at elaboration and displays back as "RPE 8"; the affine unit is gone. Pace (min/km, min/mi) is a unit of time per length. Heart rate is beats per time. A literal may be a rate of two registered units ("2.5 kg per rep"), never per day or per week (`clockRate`). Traces derive their display unit from the result's vector.

**Metrics.** One registry (`Metrics` interface plus `METRIC_DECLS` mirror): reps, load, effort, duration, distance, pace, hr, rom. Each entry carries its dimension, the bound shapes it allows, which logging types produce it (with the mass semantics for load), the fact that measures it when it is reduced from a series, which way is better, and its prose. A bound is hit when its logged value satisfies it; an unlogged value is unknown.

**Exercises.** An exercise is its registry id. Its label and logging type come from the registry at check and describe time, never from the author, so a reference cannot carry a label that lies about it. The app's exercise table plays this role in production.

**Facts.** One registry for everything external, on two axes: `observed` (standing, preSession, duringSession, postSession) and `maxAgeDays` (a stale reading is silence). During- and post-session facts need `event`, which only handlers have. Raw series never enter the language: a registered reducer turns the HR trace into `avgHr`, `timeInZone(z)` and `hrDrift`.

**Capabilities and positions.** `Expr<T, C>` carries its sort and the set of world-reads it needs. Positions grant: fn bodies `param`; init `param, fact`; plans the plan set plus `cal`; live set targets add `performed`; slot handlers add `event`; aggregates `param, state, fact, pos, cal, event, agg`; bindings `param, peer`; handoffs and advance predicates `peer, cal, fact`; policies `param, state, fact, pos, cal`; frequency gaps `param, state, peer`.

**Totality.** First-order primitive recursion over finite data. A registry is an ordered publication log, and `app` resolves only an entry published before its caller, so recursion is refused (`futureRef`). Every iterating former ranges over a finite collection or a literal bound: `fold` over a list (including `range(n)`), `repeat` blocks, `stepUntil`, `stepWhile`, `allocate`. Calendar windows are literal and at most 56 days. There is no `iterate`: `fold` over `range(n)` is the same loop with a visible bound.

**Absence.** Facts, unset state, unperformed steps, unissued targets, map lookups, a calendar gap before the first session and a ratio over zero are `Opt`. Neither arithmetic nor comparison lifts over `Opt` (`absenceUnhandled`). Sinks turn absence into a silent target whose trace names the cause.

**One machine shape at every stateful scope.** A scheme and a program's aggregate are Mealy machines over typed state. Each field is a `StateDecl { ty, init, writableBy, noun }`. `writableBy` makes the single-writer law a declaration. A field's KIND is derived from its sort, looking through opt and map: mass is `load`, sets is `volume`, anything else is `plain`. Outcome policies gate on kinds, so the cut law demotes a decrease of any mass field without knowing which method wrote it, and no label can move a field out of its reach.

**Scopes.**
- Set. A metric-keyed target record, with rest, tempo, and a `cluster{per, intraRest}` field.
- Session. A telescope of steps and literal `repeat` blocks. Counts are a set count, a count range, post-tested `until` or pre-tested `while`. At most one intensifier, on the final set.
- Slot. Owned state with session, weekEnd, cycleEnd, blockEnd and periodClosed handlers. A handler's result is ONE patch: a record from field to `{ to, mode: commit | propose }`; the empty patch is keep. Handlers judge against the issued targets.
- Day. Groups own the rest between their members: superset, circuit, emom (with a death-by form), amrapFor.
- Program. A calendar of week roles with a drift mode, a rotation, frequency declarations, policies over plans and outcomes with a declared hit policy, per-metric grids, typed exports, and imports seeded from a predecessor run.
- Muscle. The aggregate reads `slotsFor` and weekly planned sets and allocates with a literal bound.
- Macro. Fixed, bounded or open (last only) phases; `peakOn` requires anchored drift; a handoff is sugar over exports and imports.

**The verdict.** `ev.verdict(steps?, bound?)` is three-valued: `hit` (every bound logged and met), `missed` (some logged value violates its bound), `unknown` (something unlogged, nothing violated). Its sort is consumed only by an exhaustive match (`byVerdict` in the embedding). It cannot be compared, so the two-armed `if verdict == hit … otherwise count a miss` that punished silence is refused in both the embedding and the IR, and every worked handler states what silence does.

**Tables.** One former, `table(key, rows, otherwise?, overflow?)`, whose key's SORT selects its reading: a progress-clock quantity reads rows by position with an overflow (hold or cycle); an ordinal or an enum is exhaustive over its levels or tags; any other quantity reads literal, strictly ascending, inclusive thresholds with an `otherwise` (a dead or unsorted row is refused); a ref reads one row per id with an `otherwise`. `schedule(...)` survives only as embedding sugar for the clock reading. `bands`, `byLevel`, `schedule` and `mapLit` + `at` are gone from the IR; `at` remains for maps a program computes.

**Policies.** A policy is a conditional transformer with a `when`, a plan `Use` and an outcome rule, and an `origin` that fixes its place in the one application order the checker verifies: role sugar, the allocation default, the declared policies in order, then (in prescribe) the phase transform. The program's hit policy decides how co-firing policies combine, per channel (plan, outcome): `allInOrder` (the default) composes every one whose `when` holds; `first` keeps only the first. The program description renders what co-firing policies do TOGETHER, composed into one result, not one sentence each:

> When this is a deload week and your sessions in a row with a missed set is at least 3: the rules stack, so each session is 81% of the load, 25% of the sets, at least 4 in reserve and no intensifier.

A plan policy's `when` reads state and facts at prescribe; an outcome policy's `when` reads the event's stamped snapshot. `Transition.fired[…].demotedBy` lists every demoting policy. A slot plan may not branch on a week role the program also transforms (`roleDoubleEncoding`), and an outcome rule may not name a kind no field has (`noSuchKind`).

**The two clocks, as sorts.** The progress clock (`pos.week`, `pos.trainWeek`, `pos.role`, `pos.slotSession`) counts training and drives what a session contains. The calendar clock (`cal { day | earlierToday | gap(sel) | recent(sel, days, count | sum | max) }`) counts days against a stamped `LocalDay`. A quantity read from either carries its clock as part of its sort. Frequency is one declaration sort with three forms (`atLeast` tumbling expectations, `atMost` rolling caps, `minGap` spacing) and three consumers: the checker proves the set feasible, `prescribe` turns caps into an immutable soft `Due` verdict, and a per-day `dayClosed` reconciliation turns expectations into `Adherence` facts.

**Higher-order composition** is admitted in one form: a named session-to-session definition partially applied as a `Use`. Week-role deloads, readiness day-downs, reactive deloads and OPT phase character are all `Use` values; policies select them.

**Describability mechanism.** Four layers.
1. The floor (D1). `DESCRIBERS` is typed over all 47 formers and `DECL_DESCRIBERS` over every frequency form, rotation, group and drift mode, so a new one without prose does not compile.
2. Scope is never the reader's guess. A conditional statement renders as a list nested by indentation; a conditional value renders in parentheses; and/or nested in each other say "either … or" and "both … and"; a negated compound says "not both" or "neither … nor"; an unknown-guard around a statement renders its unknown arm first, at its own level; a fallback chain renders "whichever is known first: (1) …; (2) …". Demo §5j prints the four ambiguities the review found, each pair now distinct.
3. Templates and nouns are library-only (D5). A library definition's template renders (its holes must equal its params); a user definition's never does. A library `named` noun renders bare at intent zoom; a user one renders with its expansion beside it ("A 10% cut [110% of your training max]"). A user program's `says` never renders; it is described by a headline generated from its declarations. Exercise labels come from the registry.
4. Numbers explain themselves (D3). Traces cut at named definitions and show units derived from the vector.

The phrase budget (D4) is a readability LINT, not a describability guarantee: at most 4 operator nodes between name boundaries, a match costed per row like a table, a `let` always labeled so budget and prose boundaries coincide, and a `named` noun outside the library costing a node because its expansion is printed.

**Two clock vocabularies.** Progress prose says "block week" and "training week". Attendance prose says "7-day window (from your start day)" and never a bare "week" for a tumbling window.

## Describability, demonstrated

`demo.ts` runs the checker, the describer and the calendar slice over every definition; `demo.out.txt` is the transcript. Excerpts:

A three-valued handler, as a list (Couch to 5K):

```
After each session:
  - if every working set reached its target:
    - if your completed sessions this week plus 1 is at least 3: Set programme week to (your programme week plus 1), capped at 8; set completed sessions this week to 0.
    - otherwise: Raise completed sessions this week by 1.
  - if a working set fell short: Set completed sessions this week to 0.
  - if nothing fell short but something went unlogged: Leave everything as is.
```

A mixed patch (5/3/1 cycle end): "if an AMRAP fell short this cycle: Reset the note that an AMRAP fell short this cycle; and propose, for your OK: set training max to 90% of your training max."

"Missed one workout last week", reconciled from facts: "7-day window 2 (Monday 12 October to Sunday 18 October): 2 of 3 workouts (1 missed)."

An honest lower bound where v2 invented a date: "Rest today. Your next workout is not before Friday 23 October: at least 2 days between workouts."

A computed wave instead of twelve typed rows: "at your training max × the wave [the item at position the block week (from 0) of [for i = 0 … 11: 65% plus (2.5% of i)] (holding at the last)]".

## Laws

L1 to L10 stand, with these changes. L1's iteration list loses `iterate` and gains `range`. L2 points at `allocate`'s normative semantics. L4 is structural: a handler yields ONE patch record whose keys are unique, slot and program scopes own disjoint state, and policies never write, so no two writes of one event can touch the same field. L5 adds per-day causeKeys for reconciliation, expectations and adherence keyed (instance, rule, window). L6 adds due verdicts, expectations and adherence to the immutable facts, with late sessions appending amendments. L7 adds staleness as absence. L9 adds `asScheduled` projection on nominal days.

- **L11 Training causes progress.** The progress clock advances only on closed training, an owner skip, or an anchored week end. A slot boundary handler with no completed session of that slot in its window records keep(untrained).
- **L12 Stamped reads.** No term reads "now" or the live store. Every calendar read evaluates at a stamped day; every fact a handler reads, and every fact an outcome policy's `when` reads, is the snapshot carried on its event; each read is stamped with its value.
- **L13 Time alone never commits.** Calendar-caused handlers may only propose or keep. The checker refuses a committed field in a periodClosed patch (`timeCommit`), and the embedding's `periodClosed` context has neither `commit` nor `patch`.

**The two-clock law, restated honestly.** v2 claimed the clocks "never mix" while a rate literal per day, a days-to-weeks conversion, and a comparison of a calendar count with a progress count all checked. v3 states and enforces: plans MAY read the calendar; no calendar-derived value may index a progress schedule or feed arithmetic with progress-clock values. The checker enforces a slightly stronger rule, because state would otherwise launder a calendar value into a progress one: a calendar-derived quantity may be COMPARED (or key a threshold table, which is a comparison) but never stored, targeted, passed as an argument or used as an index. A rate per day or per week does not exist (`clockRate`); a progress value and a calendar value never meet in arithmetic or comparison (`clockMix`).

**The day-selection trust boundary.** The shell proposes the day to prescribe; the engine never picks it. The default the shell proposes is the rotation's next unmet day; the athlete may choose another, and a mismatch between the chosen day and the default is recorded on the issued session, never corrected by moving the workout (provenance). The engine trusts the day's identity (it must name a declared day) and nothing about its timing.

**Index bases.** Everything is 0-based: `pos.week` and `pos.trainWeek` (the first block week is week 0), `pos.slotSession`, a positional table's rows, `nth`, `range(n)` (0 … n−1), `performed(…, count)` (the 0-based index of the set being targeted), and `cal.earlierToday` (the sessions of this program already closed today; 0 for the first). The 1-based `cal.occurrence` of v2 is renamed and rebased.

## Refusals

Compile time (43 codes), each with an IR path: unitMismatch, notComparable, absenceUnhandled, unknownName, missingArg, forwardStepRef, capabilityEscape, notOwner, notWritableHere, undeclaredFact, nonGroundAccumulator, nonExhaustive, boundNotLiteral, templateHoles, exampleFailed, futureRef, peakNeedsFixed, overBudget, metricNotLogged, shapeNotAllowed, scopedFormer, infeasibleFrequency, timeCommit, anchoredRequired, restOwnedByGroup, windowTooLong, primaryMuscle, boundsInverted, openNotLast, fixedNeedsOnce, emomNeedsFixedCount, importMismatch, and new in v3: clockMix, clockRate, loggingMismatch, nExceedsMax, unlabeledLet, thresholdOrder, tableShape, roleDoubleEncoding, noSuchKind, policyOrder, and new in R2: literalDomain.

At ingest (`IngestRefusal`): emptySession (D3, EC-177), dayStampOutOfRange, programComplete (EC-161), floorNotConfirmed, and new in R2: instanceClosed, notOwnerWritable, rebindNeedsMigration.

## Decoupling

The IR is the elaborated Term JSON, content-hashed. Storage holds definitions in publication order `(id, version, ir, hash, seq)`, the ledger `(program, causeKey UNIQUE, transition)`, a head snapshot, issued sessions, Resolution rows, and the calendar facts. The vocabulary (exercises, metrics, facts, reducers) is data the checker and describer take as input. `Elaborated.reads.selectors` lists every selector a `cal.gap`/`cal.recent` read names, and the calendar keeps a last day for exactly those (plus `any` and the frequency selectors), so a read of an untracked selector cannot be built.

## Tradeoffs accepted

- A real typechecker (dimension vectors, clock sorts, capabilities by position, declared writers, metric-by-logging-type, exhaustiveness against declared enums) in exchange for never adding engine vocabulary for a new method.
- One typing authority (the IR checker) and a best-effort embedding. The embedding misses the clock sorts (`cal.count` and `pos.slotSession` are both counts in TS), a swap's or reshape's logging, threshold order, `allocate`'s n against its bound, role double-encoding, dead outcome kinds and policy order; the IR refuses all of them. The risk is drift between the two (below).
- The budget is a lint over phrase depth, not wording.
- Composed policy prose covers transformers whose bodies are scaling, capping and stripping over literal arguments; any other co-firing pair is stated in order ("…, and then …"), still as one sentence per combination.
- Handlers see one event, state, and bounded stamped windows (`cal.recent`, at most 56 days). ACWR, EWMA and CTL/ATL/TSB stay boundary-derived facts.
- A calendar-windowed magnitude (a long run capped at 110% of the last 7 days' distance) is not writable as a target: calendar values may only gate. Such a rule is a condition ("if the last 7 days' distance is above X, shorten the long run") or a boundary-derived fact.
- The calendar counts days, not hours.
- Ingestion-order replay: a late session applies when it arrives and amends adherence; it never rewrites history, and it never moves a last-session day backwards.
- The due verdict is soft. When its search horizon runs out it states only the lower bound it proved.

## What got simpler and what got stronger

Simpler. Four outcome formers (commit, propose, keep, both) became one patch record. Four table formers (bands, byLevel, schedule, mapLit with at) became one `table`. `iterate` is gone (fold over range). Two boolean verdict reads became one three-valued read. Six labelled state kinds became three derived ones. Exercise labels left the IR. The affine RPE unit and the two clock-rate dimensions left the unit table.

Stronger. Silence is decided in every handler, by construction. A field cannot be written twice by one handler. Co-firing policies are described as what they do together. The two clocks are sorts, not just dimensions. A swap, reshape or metric scaling is checked against the exercise's logging, and a mixed-logging ladder is checked against the intersection (v2's IR accepted any target on one). Nouns, labels and program blurbs cannot lie in user definitions. Due dates are never invented; late logs never regress the calendar.

Cost. 47 term formers against v2's 53. 10 new refusal codes (42 against 32). A small normalizer in the describer for composing transformer chains, a selector collector for calendar reads, and a 27-entry exercise registry.

## Alternatives considered

- Round 1's closed, arithmetic-free intents. Smallest surface, best prose, but the stress test rules it out.
- Two layers, describable intents over a hidden typed core. Named definitions give the same layering inside one language.
- Ring buffers in state for windows. Every program re-implements them and their prose is opaque.
- Counters only for time; a full wall clock in the language; calendar-driven progress everywhere (the EC-166 bug). All rejected in the time memo §2.1.
- Rolling `atLeast` expectations. One missed session would violate up to n windows, so misses would not be countable.
- A `completed` boolean beside the verdict. No worked program needs it: every rule that cared about completion cares about all three verdicts.
- Keeping author labels on exercise refs and refusing a mismatch with the registry (`labelMismatch`). Dropping labels from the IR is simpler and leaves nothing to mismatch.

## Implementation reconciliation

### Configurability round (2026-10-04, OWNER-RATIFIED)

The owner ratified the paternalism sweep's SHOULD-BE-DECLARED items: "make it configurable where needed or where we choose a specification for the user; the entire point of the language is to give users all the power to define programs." Eleven items (C1–C11, the round spec), one law for all of them: the default is the engine's prior behavior and is OMITTED from the IR (the weekbasis one-form precedent), every declared value is checked where it is declared, part of the program hash, and stated by the generated prose; stamped prescriptions, resolutions and issued adherence windows never re-derive under a changed value. The grammar stays at 47 formers and 43 compile-time refusal codes: every item is an option FIELD or a declaration, none a former. SPEC section 7 ("Declared options") is the consolidated table. `config.test.ts` (verify step 5, recorded into the kit) holds 27 tests; all 27 fail against the frozen pre-round oracle (`../synthesis-patfix/`), the C1 failure showing the old GZCLP behavior exactly (the stage demoted where the method's rule progresses). The transcript is `../config-prefix.txt` (regenerated by `../config-prefix.sh`). Four embedding negatives joined negative.ts (48 directives).

| item | status | where it lives | what now holds |
|---|---|---|---|
| C1 | done | the verdict read (`event.q.success`) and the slot (`SlotMeta.success`; the read wins; `judge.verdictOf` 4th arg) | `success: totalReps` sums the reps floors of the slot's expected judged sets against the logged reps, decidable early in the hit direction only (a miss needs every set logged; an atMost reps ceiling and every non-reps metric stay per-set bars, so an unlogged set with a load bar still holds unknown). `{atLeastSets: n}` scores sets whole: hits ≥ n is hit, hits + unknowns < n is missed. The worked GZCLP definition now declares the method's published rule on its verdict read ("counting total reps across all sets", in its says); 3,3,3,2,5 clears 5×3+. NOT built: the spec's parenthetical "overridable per-policy" — no policy consumes a verdict in this grammar (policies transform plans and demote outcomes), so there is nothing for a policy-level rule to bind to; per-read plus per-slot covers the surface. Prose: "How the working sets went (counting total reps across all sets)."; the match arms follow the rule. |
| C2 | done | the program (`ProgramDef.e1rm {formula, maxReps?}`), the read (`event.q.e1rm.formula` wins), threaded on `EventSource.e1rm` (present only when declared) | Epley (default), Brzycki `(w×36)÷(37−r)` (domain r ≤ 36), Lombardi `w×r^0.1`, Mayhew `(100×w)÷(52.2+41.9×e^(−0.055r))`, operation order pinned in SPEC 3.3. X6's rule holds for all: r = logged reps + logged RIR. Out-of-domain reps (the formula's own edge, or the declared maxReps) make the read `none(outsideFormulaDomain{formula, reps})` — a 15th absence cause — never a silently skipped set. `lib/load-for` stays the Epley inverse; a non-Epley program supplies its own inverse where it seeds state (stated in SPEC). Prose: "The max estimated from “work” (Brzycki)."; the program line names formula and cap. |
| C3 | done | the program (`ProgramDef.adherenceWeeks`), instance-overridable at activation (`runtimeOf`'s `overrides` → `calendarSpecOf` 6th arg → `CalendarSpec.adherenceWeeks`, present only when aligned) | `calendarAligned {weekStart}` makes `per week` windows calendar weeks from the declared weekday, indexed from the anchor's aligned week; activation mid-week is a lead-in with no window (the open-on-start law unchanged). Adherence and frequency windows only — the progress clock, day/days(n) windows and every `cal.*` read are untouched, and issued expectations stay immutable under a later change (they snapshot their window). Prose wired: "in each calendar week (Monday to Sunday)" and "Calendar week (Monday 12 October to Sunday 18 October): …" against the default's "7-day window" forms. |
| C4 | done | the program (`ProgramDef.volumeWeights`), consumed by `ports.plannedSets` (the one planned-volume counter; there is no separate trained-volume event read in the oracle — the spec's "trained-volume event read" names no existing surface, reported as such) | `stage` (default 0.5) weights each intensifier stage, `cluster` (default 1) each clustered judged set, domain (0, 1] checked. upperHypertrophy's chest week reads 6 by default, 8 under `stage: 1`; back 8 → 4 under `cluster: 0.5`. Prose: "Volume counting: an intensifier stage counts as 100% of a set." |
| C5 | done | the program (`ProgramDef.stripIntensifierOn`), consumed at `issue.issueSlot` (L10) | The strip-role list is the program's (default deload/taper/test; `[]` never strips by role); the one-intensifier dose law itself stays law. Each listed role must be a week role (`unknownName`) AND a week of the program's calendar (`literalDomain`, the X4 posture). L10's text in engine.ts and SPEC updated. |
| C6 | done | the program (`ties: 'up'`, beside `grids`; never per viewer — the issued number is a shared fact), stamped as `Stamp.ties`, threaded as `Ctx.ties` and `sinkField`'s 4th arg | `units.nearestStep` gained the ties-up integer formulation `n = ⌊(m + Q/2) ÷ Q⌋` (pinned beside BV-25/26's ties-down). Exact bounds at the sink and `round nearest` follow it; floors and ceilings stay directional. Resolution quantizes against the STAMP, never re-deriving. Known limit: `issue.setsDue` (the live set-count helper, which has no stamp in scope) evaluates its condition with default ties; a round-nearest inside an until/while condition of a ties-up program is the one place the direction is not threaded. Prose: the grid line adds "(a target exactly between two grid steps rounds up)". |
| C7 | done | the instance activation spec (`runtimeOf`'s `overrides.lapseAfterDays` through the CalendarSpec seam); the program field stays the declared default | The lapse clock reads `spec.lapseAfterDays` (it always did); the override replaces it at activation and the boundary refuses a value below 1 (recorded as a throws fixture). The program description states the declared value; the spec carries an instance's active one (the describer surface for a running instance is the spec, not the def). |
| C8 | done | the program (`ProgramDef.staleness`: fact key → days), consumed by `ports.factPort` (one seam: activation, plans, handlers, policies all pass through it) | The override replaces the registry's `maxAgeDays` for the named keys; `factStale` carries the ACTIVE limit, so the existing absence prose states it. Checker: `unknownName` (no such fact), `undeclaredFact` (neither the program nor any bound scheme reads it), `literalDomain` (days < 1). Prose: the Reads line marks an override "…, by this program"; a scheme-read-only fact gets its own "Freshness: …" line so the declaration is never mute. |
| C9 | done | the `scaleSets` xform node (`allowZero: true`, refused on any other op) | `scaleCount`'s floor becomes 0: a line whose scaled count rounds to zero issues no sets, judges nothing (never a vacuous hit; with nothing logged the slot is still the untrained non-event) and counts no volume — stated in SPEC 3.2. `describe-defs.normal()` refuses to compose an allowZero chain into one factor (the shared count rule no longer holds), falling back to the stated-in-order form. Prose: "…, with 25% of the sets (a line may drop to no sets)". |
| C10 | done, GRAMMAR AMENDED (a declaration field, not a former) | `FnDef.defaults` / `SchemeDef.defaults` (omitted when empty) | Ledger of the amendment: checker — defaults are closed values checked at the example position against the param's sort (`unknownName` for a non-param, `unitMismatch` for a wrong sort); `app`, `Use` and slot bindings may omit a defaulted param (`missingArg` only otherwise); a library template's holes must equal the params WITHOUT defaults, and a non-default argument for a hole-less defaulted param is appended to the rendered template ("(with lo = 5 reps, hi = 8 reps)") while an argument spelling the default renders nothing (one prose form, no mute override; `describe.overrideKeys` compares canonical JSON). Evaluation and `slotParams` take an omitted default's value evaluated with no ports. ir-schema and the kit follow; negatives in config.test.ts (the TS embedding's `defaults` is typed per param; its examples still spell every argument — a tsc inference constraint, stated below). Promotions (each default = the prior literal, so the corpus is behavior-identical): `lib/double-progression` `lo`/`hi` (reps 8/12 — the says already claimed "the phase rep range" while the body hardcoded it), `lib/531-jokers` `jokerStep` (105% — the Joker convention is 5–10%, a coaching choice), `lib/hr-tempo` `start` (20 min starting tempo block), `lib/pain-gated-loading` `morningGate` (pain 4/10 morning cutoff). KEPT literal, with reasons: 5/3/1's 65–95 wave and 40/50/60 deload, APRE's chart and 50%/75% ramps, GZCLP's 5×3/6×2/10×1 stages and 5RM retest, C25K's nine-week ladder, RP's 3→2→1→0 RIR ramp (method identity, all); hrTempo's 85–89% zone and Borg 17 gate, easyRun's 75%, painGated's 2/10 and 5/10 in-session gates, isoHold's 2-min rests, bbb's deload "three sets", clusterStrength's 6-in-2s shape, stabLadder's 4-2-1-0 tempo, juggernaut's 90% TM (each pinned by the definition's own says or the published protocol; promoting them would make the template lie or fork the method). |
| C11 | done | the PROJECTION call: `describe-run.sessionText(issued, reg, viewer?)` with `viewer.mass: 'kg' | 'lb'` (`viewerDisplay` exported for other surfaces); no engine state, no IR field | Every mass-dimension metric renders in the viewer's unit, converted display-exactly from the canonical value (the locale's at-most-three-decimals rule states the rounding: 117.5 kg → "259.043 lb"); grids and issued numbers stay program facts in the grid's unit and are never re-quantized. An empty viewer is byte-identical. It could be done honestly at the projection layer alone, so nothing moved into per-user engine state. |

**Embedding notes.** `fn`/`scheme` specs take `defaults`; their `examples` must still spell every argument (TypeScript cannot infer the param record once the example args admit omission — the IR-level examples MAY omit defaulted params and the checker and `runSchemeExample` honour it). `ev.verdict` gained a third argument (`'allSets'` is accepted and dropped), `ev.e1rm` a formula, `scaleSets` an `{allowZero: true}` option; internal engine call sites omit every default argument so recorded fixtures keep their pre-round shape.

**Prose samples.** "GZCLP T1 on Barbell Back Squat: 5×3+, … adding 5 kg on success, counting total reps across all sets; …" · "Estimated one-rep maxes use the Brzycki formula, from sets of at most 10 effective reps." · "Train at least 3 times in each calendar week (Monday to Sunday)" · "Volume counting: an intensifier stage counts as 100% of a set." · "No week role drops the intensifier." · "loads on a 2.5 kg grid (a target exactly between two grid steps rounds up)" · "Freshness: your estimated max is ignored once older than 3 days (this program's rule)." · "4 sets of 8 reps to 12 reps at your working weight." (a promoted range reads through its params; the old literal-only "8–12 reps" compaction no longer applies to it) · "3 sets of 5 reps at 117.5 kg" / "… at 259.043 lb" (the same issued fact under a kg and an lb viewer).

**Fixtures.** Of 615 stored kit files before the round, 566 are byte-identical, 49 changed, 0 removed, 49 are new (the recorded config suite: 18 eval, 11 prose and 20 refusal files; `../../config-fxdiff.py` regenerates the classification). The changed, by cause: README.md, SPEC.md, ir-schema.json, fixtures/manifest.json (the option fields, the new absence cause, the section-7 table, hashes); the five touched definitions (`lib/gzclp-t1` — C1's declared rule and its says; `lib/double-progression`, `lib/531-jokers`, `lib/hr-tempo`, `lib/pain-gated-loading` — C10's literal→param bodies and `defaults`); 15 eval fixtures whose stored IR or traces embed those bodies (12 laws.*, demo.8, differential.setup, semfix.f23 — no VALUE in any of them moved, only the term nodes and traces); 20 prose fixtures over the same definitions (demo.5f/5g, 18 differential files: GZCLP's verdict arms per C1, promoted params rendering through their names per C10); 5 refusal fixtures whose informative `message` text moved (templateHoles' new wording ×3, and two demo refusals embedding the touched defs — codes and paths unchanged, messages exempt in conformance mode). The demo transcript changed in the four GZCLP slot lines only (8 diff lines against the pre-round transcript).

### Correctness interrogation round (2026-10-04)

Three adversarial reviewers (patrev-a, patrev-b, patrev-c) probed the package after the weekly-basis round; the parent adjudicated the one conflict by running both probes (A's p1 against B's probe4: both correct, the batching bug real). Scope law: correctness ONLY — the grammar stays frozen at 47 formers, and no configurability item from the paternalism sweep landed (those are pending owner decisions). Every probe below is a named regression in `patfix.test.ts` (verify step 5, recorded into the kit). Against the frozen pre-round oracle (`../synthesis-weekbasis/`) 9 of its 11 tests fail; the two that pass are the IR-side X3 characterization (the checker was always right; the defect was the embedding, shown by the transcript's tsc section) and B's probe4a lapse arithmetic (a must-stay-green guard). The fail-first transcript is `../patfix-prefix.txt` (regenerated by `../patfix-prefix.sh`).

| item | status | what now holds |
|---|---|---|
| X1 | fixed | `aggPort.measured`: the `role === null → noUpcomingWeek` absence is gated to `basis: 'upcoming'`. A closing/default read past the end of a `once` calendar keeps the position's `?? 'train'` role and evaluates (a DEFAULT weekly read is typed plain and never produces a none — the F1 shape); `upcoming` there is still `none(noUpcomingWeek)`, and a roles filter gates on `'train'`. (A, C probed the evaluator crash; B flagged the same lines.) |
| X2 | fixed | `step.ts` dayClosed is ONE per-day loop: each newly closed day in order closes the day, fires that day's periodClosed handlers against its post-close state, then runs the anchored week-close check against the same state. Batched and daily delivery are indistinguishable (L5): A's p1 is the regression, plus a split-point property test (several partitions of the same day range ⇒ identical seq-stripped terminal state, emitted closes and fired handlers). The calendar now records per-day causeKeys on a batched close, so `seen` matches daily delivery too. |
| X3 | fixed | `structure.ts WeeklyOf<T, O>`: plain `Q` only when the options are PROVABLY default (`[O] extends [{ basis?: 'closing'; roles?: 'all' }]`); a widened or unknown options type is `Opt`, as the IR types it. Both directions pinned: the arithmetic-over-widened-read `@ts-expect-error` in negative.ts (IR twin: absenceUnhandled, demo §3) and the compiled `known(...)` positive beside it; the tsc fail-first evidence is in `../patfix-prefix.txt`. |
| X4 | fixed | A `roles` list disjoint from a KNOWN calendar's role set is refused (`literalDomain` at the option's path, naming both sets) instead of being silently absent every week. `ProgramView` gained `roles` (null when no calendar is in view, so bare scheme scopes are unchanged); ir-schema follows. (A W4, p5.) |
| X5 | fixed | `time.ts closeDay` resolves the pause for the open day BEFORE reading the lapse clock, so the day a bounded pause ends a still-untrained instance is `lapsed` at once, never `active` for one day (A p7, C p3 agreed). B's probe4 lapse arithmetic (21st unpaused day; a 10-day pause defers exactly 10; overlapping pauses count once; catch-up ≡ day-by-day) is ported and green. |
| X6 | fixed | One e1RM rule: the event-path Epley counts logged reps in reserve as reps (`w × (1 + (reps + RIR)/30)`, asReps), so it and `lib/load-for`'s inverse round-trip exactly; an unlogged effort adds nothing. Stated in SPEC 3.3 beside the F6 absence rules. OWNER-OVERRIDABLE: the RIR treatment; the formula CHOICE (Epley vs Brzycki etc.) is a pending owner configurability decision and was not touched. |

**Documentation (same round, no semantics change beyond the above).**
- D1: SPEC 3.3 states the `upcoming` stance explicitly — it advances `pos.week` (and `trainWeek`/`role`) only; `pos.slotSession` and every `cal.*` read measure today's values; across a cycleEnd/phase boundary it does NOT see the pending TM bump; for a cycling calendar inside a bounded macro it measures the same program's next block week.
- D2: the closing-basis prose stopped claiming "got in the week just ended": a closing read re-plans under the handler's pre-state, so the describer now says "the sets X is now planned to get in the week just closing" (both bases say "now planned"; the honesty also covers D1's pending-bump case, which static prose cannot condition on). Changed prose fixtures and demo §5b/§8c follow.
- D3: B N3 (a static subterm re-evaluated during issue-time capture, so a recorded fact-source call could double) was trivial and is fixed: `captureFrame` evaluates a static binder value, condition or iteration source ONCE (`once`), with a patfix regression counting port calls. B N4 (the sink-note trace node reuses its session argument's `node`) is recorded as a KNOWN NIT: a distinct node would need a synthetic Term, which the 47-former freeze forbids; the reused node is only ever read for display and the note disambiguates it.

**Fixtures.** Of 604 stored kit files before the round, 587 are byte-identical, 17 changed, 0 removed, 11 are new (the recorded patfix suite: 10 eval files and 1 refusal file; `../../patfix-fxdiff.py` regenerates the classification). The changed, by cause: ir-schema.json, SPEC.md, README.md (the X4 ProgramView.roles schema field and the D1/D2/X1/X2/X5/X6 spec text); fixtures/manifest.json (hashes); 6 refusal/eval fixtures whose recorded checker scope now carries `roles: null` (conformance.notcomparable.6, hardening.unknownname.5/6/7/12, semfix.unitmismatch, hardening.obs-13); 2 semfix F8 fixtures whose recorded calendar `seen` sets gained X2's per-day causeKeys on catch-up closes (semfix.f8-…-p6, semfix.f8-…-p7; no value or status in them moved — in p6 a now-identical calendar is additionally shared by `$ref` where it was repeated); 4 prose fixtures carrying D2's honest closing sentence (demo.5b, demo.8c, differential prog/rp-upper-meso, weekbasis describer). The demo transcript changed in the same three RP prose lines only.

### Configurable weekly basis (2026-10-04, OWNER-DIRECTED)

The owner ruled that where a semantics choice is genuinely a coaching judgment it becomes a declared option with a describable default, and the engine's laws stay fixed (the configurable-where-unsure ruling). One such place was found: what a weekly aggregate read measures (the F20 consequence noted under the semantics review round below). This round makes that choice an option of the read. It adds no former: the 47-former freeze holds (verify step 4).

**The options.** `agg weekly` gains two optional fields. `basis` is `closing` (the default: the week just closing, as F20 measures it) or `upcoming` (the coming week's plan, measured by the same pipeline F20 established, at the position one block week on). `roles` is `all` (the default) or a non-empty list of week roles: on a week whose role is not listed the read is ABSENT, `none(roleExcluded{role})`, never zero, so a volume rule gated on it goes silent instead of seeing shrunken numbers. In the final week of a `once` calendar, `upcoming` is `none(noUpcomingWeek)`. A read with either non-default option is `Opt`, so the checker makes every author handle the absence (`absenceUnhandled` otherwise); a read with defaults, written or omitted, keeps its plain sort, so no existing definition moved. The embedding mirrors the rule in its types (structure.ts `WeeklyOpts`, a conditional return type) and drops defaults, so a default read has one IR form. Two absence causes were added to `Absence` (engine.ts, ir-schema, SPEC 5); without them an absent read could not say why.

**Checker.** The options are validated where the weekly read is already legal: an unknown basis and a role that is not a week role are `unknownName` naming the bad value at the option's path; an empty roles list is `literalDomain` (a read that is absent every week). The capability is unchanged (`agg`, aggregate positions only).

**Describer.** Defaults render exactly as before (no clause). A declared choice is stated: "the sets the muscle got in the week just ended, accumulation weeks only", "the sets chest is planned to get in the coming week". The roles clause names the included roles rather than the excluded ones ("deload weeks excluded"): the describer context carries no calendar, and adding one would change the context argument of every stored prose fixture for a phrase the inclusion form already states exactly.

**RP declares the coaching-correct choice.** `prog/rp-upper-meso` measures the week just closed, counted only when it was an accumulation week: a deload's halved sets are not what the muscle gets, so they must not drive allocation. Its weekEnd now computes "the reallocation" as an optional map (absent when any muscle's read is absent, which under a week-role filter means the whole week) and commits target and extras only when it is present; otherwise it keeps. Behavior change: the deload weekEnd records a keep (the empty patch, with its trace) where it proposed targets and extras out of the deload's numbers. Since RP's calendar is `once`, nothing was ever issued from that proposal, but the shape no longer depends on that accident. The accumulation weekEnds are unchanged (the EC-136 law tests pass as they were). Demo §8c runs one rule ("12 chest sets minus the weekly chest sets") under default options and under RP's declaration at the deload weekEnd (8 sets to place out of the deload's 4, versus unknown with its cause), then RP's recorded weekEnds.

**Rejected.** A new former for the upcoming measurement (breaks the freeze, and it is the same measurement at another position). Reading a filtered week as zero (it would allocate the whole target, the corruption this round removes). A program-level switch instead of a per-read option (one program can need both measurements, and the read is where the prose states it). Making `upcoming` see the handler's own writes (a handler reads one pre-state, L4).

**Tests and fail-first.** `weekbasis.test.ts` (verify step 5, recorded into the kit): the RP keep and the roleExcluded absence are regression tests, and both fail against the frozen pre-round oracle (`../synthesis-semfix/`); the upcoming basis has positive tests (an ordinary week equals the next week's closing read and is halved going into the deload; the final week is `noUpcomingWeek`); checker and describer tests cover the options. The pre-round run is `../weekly-basis-prefix.txt` (7 of 8 fail; the one that passes characterizes that a filtered read on a listed week equals the default, which the old oracle got right by ignoring the filter), regenerated by `../weekly-basis-prefix.sh`. Two embedding negatives (a misspelt role, arithmetic over a filtered read) with their IR twins in demo §3.

**Fixtures.** Of 585 stored fixture files before the round, 503 are byte-identical, 80 changed, 2 were replaced (registry snapshots, renamed by content) and 18 are new (`../../weekbasis-fxdiff.py` classifies them). Of the changed: 57 are encoding only, binder renumbering (RP's handler gained binders, so every definition built after it in programs.ts has shifted `v` names) and the program hashes and registry ids that follow; 15 carry RP's new weekEnd IR as an argument (its definition, 8 refusals that clone RP, some with error paths moved into the new `let`, 5 eval and 1 prose fixture that embed it); 2 are RP's new prose (demo §5b, the differential's RP description); 5 are the behavior change, RP's deload weekEnd recorded as a keep; and the manifest. ir-schema.json, SPEC.md and README.md follow. The demo transcript changed in §3 (the two IR twins, four RP refusal paths), §5b (RP's prose) and the new §8c.

### Semantics review round (2026-10-04)

Three adversarial readers (semrev-a, semrev-b, semrev-c) read SPEC sections 3 and 4 against the oracle and left probe scripts. Every probe is now a named regression test in `semfix.test.ts` (verify step 5, and recorded into the kit). Against the frozen pre-round oracle (`../synthesis-ratified/`) 47 of its 49 tests fail; the two that pass are characterizations of `nearestStep` and of literal storage, which no reader found wrong. The fail-first transcript is `../semfix-prefix.txt` (regenerated by `../semfix-prefix.sh`). Seam open item 6 (the semantics half's adversarial read) is resolved by this round.

**Decisions.** Every decision below is an OWNER-DIRECTED-DEFAULT: set under the owner's standing directive (objectively correct per the existing laws, never what fits best) and overridable by the owner only. None needed a grammar change; the grammar stays at 47 formers and 43 compile-time refusal codes. One ingest refusal is new (`notALocalDay`, 8 in all).

| item | status | what now holds |
|---|---|---|
| H1 | fixed | `testkit.liveLog` accumulates resolutions across live logs, `closeOf` carries them; every probe is a test. |
| F1 | fixed | `nth` over an empty list and a table with no rows are `none(emptyPick)`, never an undefined value. Reachability closed: an enum declaring no tags is refused (`literalDomain` at `enums.NAME`); activation refuses an empty list for a non-empty list parameter. |
| F2 | fixed | Frames are binding-environment-correct: reads keyed by their CLOSED node (canonical JSON, variables replaced by values); captured by a walk that evaluates static subterms, binds static binders, iterates static lists and follows static conditions; `keys` became a captured read. The checker refuses a fact whose key depends on a logged set in a live position (`capabilityEscape`, cap `fact`). |
| F3 | fixed | `Resolution.seq`; a cell's LATEST row decides (A → B → A writes a third row); `currentView` orders by seq. |
| F4 | fixed | `resolveLive` re-reads the view after every row. |
| F5 | fixed | Live reads and readiness name the step declared before the reading step (`visibleStep`): the current iteration in a repeat block. |
| F6 | fixed | e1RM skips a load-less set where the logged load is the lifted load; none qualifying is absent. A missing load reads 0 only for weighted (added) and assisted (assistance) bodyweight. |
| F7 | fixed | One rule (`assistedLoad`) for the verdict, event reads, the `performed` former (`ctx.logging`) and live resolution. |
| F8 | fixed | Lapse and `cal.gap` use the latest session day on or before the day, never ingestion order; a gap is never negative; `dayClosed` is monotonic and catches up skipped days. |
| F9 | fixed | `skip`, `pause`, `resume`, `abandon` of a completed instance refuse `programComplete`. |
| F10 | fixed | Anchored weeks close on `anchor + 7k + 6`, `k ≥ 0` (true modulus; nothing before the anchor); activation before the anchor is DEFINED as a lead-in. Projection reconciles before issuing and stops when the calendar ended the weeks asked for. |
| F11 | fixed | `prescribed` (former and event read) is a quantity of the metric's dimension in its display unit; plan and program contexts carry the display units. The "7030%" trace reads "155 lb (153 lb (170 lb × 90%) …)". |
| F12 | fixed | A literal `scaleSets` factor above 1 is refused (`literalDomain` at `arg`, after the arg's sort); an evaluated one never grows a count past its targets (`min(n, …)`), traced. |
| F13 | fixed | The sink preserves direction: exact nearest (ties down), floors up, ceilings down; reps quantize to whole numbers; an inverted range, or one left with no grid point, is `outOfDomain`; a literal inverted range or count range is refused; an evaluated inverted count range issues its max as both edges. |
| F14 | fixed | `PerformedSet.completed` is gone; `boundaryLogged` drops uncompleted sets; only uncompleted sets is `emptySession`. |
| F15 | fixed | A slot with no logged set in a closing session records `keep(untrained)` and does not advance (slot sessions, week and cycle slots, occurrence slots). |
| F16 | fixed | `paused` is real: the status while a pause covers the open day; the lapse clock counts unpaused days only; a zero-length pause covers and voids nothing; the head mirrors it. |
| F17 | fixed | capEffort on `atMost v`, `v ≥ cap`, is the range `[cap, v]`. |
| F18 | fixed | Increase/decrease is present → present only (`moved`, exported for its test). |
| F19 | fixed | Duplicate readings: largest `observedOn`, then the later one (`latestReading`, also for bodyweight in the event reads). |
| F20 | fixed | `weekly` is the planned volume of what WOULD BE ISSUED (policies, phase transform, L10, the sink), over planned targets only, absence-aware, in the metric's dimension and display unit. |
| F21 | fixed | The issued slot trace chains the plan, each policy and the phase transform (each transform's session-argument kid is the previous trace), and a last node carries the sunk session with a note of what L10 and the sink changed. |
| F22 | fixed | `issueKey` ends with the state seq; resolution digests are over canonical JSON. |
| F23 | fixed | `Projected<T>`: projected sessions, the projected ledger and each phase's handoff values carry `projected: true` and `assume`. |
| P1 | fixed | `canonical.ts`: canonical JSON and FNV-1a over UTF-16 code units for frame keys, digests and the program hash; conformance now compares digests. |
| P2 | fixed | A slot id, day name or state field spelled like an array index is refused (`literalDomain`); order tests with index-like ids pass for lists, pick and allocate. |
| P3 | fixed | `parseLocalDay`/`localDay` accept real dates only; ingest refuses an impossible stamp (`notALocalDay`). |
| P4 | fixed | Arithmetic law stated (binary64, no reassociation); `cmpNum` handles infinities and its non-transitivity is stated; allocate's cap is `floorQ(cap)`. |
| P5 | fixed | `clock` rounds to whole seconds first; the empty sum takes its partner's dimension; activation is order-independent (passes to a fixpoint); `volumeKeep` granularity (per field) and `sameValue` (ignores unit, per, notation, dim and clock, and the causes of two absences) are stated; the reshape and swap runtime twins match the checker. |

**Adjudication 1: is nth over an empty list reachable?** Reviewer B said yes (the evaluator returns an undefined value), reviewer C said the checker refuses it. Running the probes: both are right about what they ran. B's literal empty list and C's `slotsFor` of a primary-less muscle are both refused by the checker (`unitMismatch`, nth needs a list typed non-empty). But the type rule trusts `keys enum:NAME` to be non-empty, and an enum may be DECLARED with no tags: a FnDef whose body is `nth(keys enum:e, 0)` checked clean and crashed its own example (the frozen oracle reported `exampleFailed` from a JavaScript TypeError). So it was reachable; the checker rule (an empty enum is refused) closes the static path, the activation check closes the runtime one, and the evaluator's `emptyPick` is the typed answer if anything else ever leaks in.

**Adjudication 2: when is an instance paused?** The spec says "set on pause, cleared on resume". Read literally (the event sets it, only a resume clears it), the demo's bounded pause (28 to 30 October, no resume event) would leave the instance paused forever, which the probe of the demo fixtures showed. Chosen: the status is paused while a pause covers the open day, so a pause from today is in effect at its event, a future pause on its first day, a bounded one ends by itself and a resume ends an open one. This is the literal rule wherever the literal rule is defined.

**Consequences worth a look (not reviewer conflicts).** F20 made a weekEnd aggregate measure the closing week's issued volume, so at RP's final weekEnd (the deload week) the read saw the deload's halved sets and the proposed weekly extras rose (0 → 2 and 2 → 4 sets on two slots). Resolved by the owner-directed round below: the measurement is now a declared option of the read, and RP declares `basis: closing, roles: [accumulation]` (programs.ts `RP_VOLUME_READ`), so its deload weekEnd is a recorded keep.

**Fixtures.** Of 528 stored fixture files before the round, 443 are byte-identical and 85 changed; 57 files are new (the regression suite's calls, and calls the new code paths make top-level in existing tests). Causes of the changed files, by leaf differences (`../../semfix-fxdiff.py`, `../../semfix-fxother.py`): P1 program hash (79 files) and F22 issue keys (79), F21 trace chains and F11 trace units (60), F14 the completion flag (56), F23 projection tags (25) and handoff wrapping (5), F11/F20 dimensions and units (19), F3 resolution seq (5), F22/P1 resolution digests (5); behavior: F20 RP's final-week extras (5 files, above), F16 the demo's paused status (1 file), F2 capture re-reading facts so recorded fact-source calls double (15 files, `world` lists only; in one, F20's aggregate path also makes sink and evaluate calls top-level fixtures), F13 whole-number grids on sink calls (1 file); encoding only: `$ref` sharing moved where projected sessions became copies. The demo transcript (verify step 3) did not change.

### Ratification round (2026-10-04)

The owner ratified the R2 law decisions as written, with three directed changes. Each is stated once in the "R2 law decisions" list below (SPEC 6.1). Every new or changed behavior has a test that failed on the frozen pre-round oracle (`synthesis-hardened/`); both pre-fix runs are recorded in `../ratify-prefix.txt`.

**EC-136, RP allocation: weekly gap, weekly sets.** The gap the muscle plan computes is weekly (`setsFor` counts each slot's per-session plan times its sessions a week), but an extra set it gives a slot is added to every session of that slot. The cable fly sat on both days, so each set it won was issued twice. Chosen: extras attach to defined sessions of the window. A slot that can receive extras is trained once a week, so RP's fly is two slots, `cableFlyA` on upperA and `cableFlyB` on upperB, and the state noun is "weekly extra sets". The prose needed no new words: "plus any sets the muscle plan adds" and "the sets still to place" are now literally true. Rejected: a weekly extra map plus a per-week consumed counter decremented by sessionClosed. It cannot be written in the grammar, and adding to the grammar would not save it. The aggregate's session handler cannot see which slots trained (only `trained(muscle)`), slot handlers cannot write program state (L4), and the plan that issues the remainder in the slot's first session of the week makes sessions non-uniform, so `setsFor`'s per-session-times-frequency count would be wrong in the very handler that computes the gap. Cost of the choice: the fly's two days progress their loads separately, which matches how the two days are logged. The once-a-week rule is held by a law test over the corpus, not by the checker (an R3 lint candidate). Test: the RP law test gives the fly the best stimulus-to-fatigue score and checks that the week after allocation issues exactly the 12-set chest target (the frozen oracle issued 16).

**EC-146, acceptance re-checks writability.** A proposal now records its proposing handler (`Proposal.on`). Accepting re-checks every proposed field against its current declaration: the field must list that handler or `owner`, because the owner's acceptance counts as an owner write. Otherwise the proposal is void, never applied, and `unwritable:key` is emitted (checked before staleness). Only a rebind to a scheme with the same state types but different writers can make a field unwritable. "Owner acceptance counts as owner" is read as an alternative to the proposer, not a replacement for it: requiring `owner` alone would void every RP allocation proposal, whose field is writable by weekEnd only. Test: a stalled squat proposes a load drop, the slot is rebound to a variant whose load is writable by cycleEnd only, and acceptance changes nothing and records `unwritable:`; the same rebind to an owner-writable variant still applies.

**BV-25/BV-26, one quantization law.** `round` to nearest now sends ties down, as the sink does, by one function (units.ts `nearestStep`) whose operation order is pinned for a second implementation. The 1e-9 epsilon is gone from nearest rounding: the quotient is scaled to integer billionths of a step and the rest is integer arithmetic, so a tie is decided the same way on every platform. For the sink the new formulation changes a result only when the quotient lies between 0.5×10⁻⁹ and 10⁻⁹ steps above a half-integer: that used to count as a tie and now rounds up. Tests: exact ties on a 2.5 kg grid, a half-rep tie (7.5 → 7), a negative tie (toward −∞), a lb tie in canonical kg, and the two sides of the half-billionth boundary, each for `round` and the sink. No stored fixture moved because of ties: the corpus never rounds a tie with `round`, and the sink's reformulation reproduced every stored load.

**What else moved.** A `$ref` path in the kit now escapes `/` and `~` in a segment (RFC 6901). It had to: the RP proposal key `proposal:week:prog/rp-upper-meso:0:program` contains a slash, and the first fixture to share a value under it (the new RP test) produced a dangling reference. No existing `$ref` contained either character, so no stored reference changed.

### Oracle hardening (the handoff-kit round)

Writing the typing half of the kit's SPEC (`kit-spec-typing.md`) meant reading the checker as a second implementer would, and that reading listed 31 observations where the code, its comments, or the laws disagreed. The Rust side will reproduce whatever the oracle does, so a wrong oracle answer would become a wrong Rust answer with a passing fixture. Every observation was checked against the source and triaged. The table is in the SPEC (Typing, Observations); the reasoning behind the verdicts is here.

**Fixed (23).** Each has a test in `hardening.test.ts` that failed on the oracle before its fix; the pre-fix run is recorded in `../hardening-prefix.txt`.
- The clock law had two holes. `orElse` with a plain fallback returned the optional's element sort without joining clocks, so `orElse(none days, cal.day)` was plain days and could be committed into state (obs 1). And a param, result or state field could be declared on the calendar clock, which stores or passes a calendar value by declaration (obs 2). `orElse` now joins the two clocks (a calendar fallback taints the result, and the sinks refuse it), and a calendar-clocked declaration is `clockMix` at the declaration. The IR negative for the first sits in demo §3 with the rest of the clockMix family.
- `eqTy` had the list rule backwards: a non-empty list did not fit where a possibly-empty one was wanted, and the reverse fitted (obs 31). A literal non-empty `allocate.among` was refused; an empty list could be passed for a non-empty parameter.
- Authoring JSON could crash the checker or get a wrong answer. An unknown unit threw (obs 5), an unknown literal kind reported `unknownName` with no name (obs 4), an unknown `xform` op was accepted as if it took no argument (obs 16), and unknown `pos` fields and `keys` collections typed as weeks and muscles (obs 9, 10). Each is now `unknownName` naming the bad name.
- Names that a program declares are now validated wherever a program is in view: ref literals of kind slot, muscle and day (obs 6), `agg weekly` tags (obs 13), handler event keys (obs 29), example and handoff argument names (obs 24). Exercise-keyed table rows are validated against the vocabulary, which is always present.
- Publication order (L1's DAG by time) now covers imports and macro phases (obs 26), which looked programs up by key with no order check.
- Dead or impossible rows and stages: duplicate ordinal or enum rows and a `null` ordinal row (obs 11), a technique with no stages and a negative tempo (obs 17), a non-integer frequency count (obs 27), and a threshold row that is a rate per day (obs 12).
- Refusal content: a refused fact key no longer adds a spurious `missingArg` (obs 7); `top`, `ratio` and `round` now say `absenceUnhandled` for an optional where a plain value is wanted, as every other former does (obs 20); an `until`/`while` condition and a `metricNotLogged` on a non-literal target now report at paths that exist (obs 14, 15); a program's `prevPhase` peer read no longer resolves like `current` (obs 30); and an omitted `rest` no longer counts as prescribing rest inside a group (obs 23).

**Specified, not changed (6).** obs 8 (an unkeyed fact's key: the code is the message, the `ONE` payloads are placeholders), 19 (formers that return a sort after a child refusal), 21 (`app` is not a budget boundary for its arguments), 22 (`patch`'s `cap: 'event'` stand-in), 25 (`templateHoles` order differs between fns and schemes), 28 (feasibility is not judged over a period longer than 28 days, which only a pattern rotation's default can still produce). Each is now stated in the SPEC rule it concerns and, where the code is the only reader, in a source comment. Changing any of them would reorder or rename refusals in existing fixtures for no gain in what is accepted.

**Not a defect (2).** obs 3: the `any` sort was never produced, so it was deleted (with `asTy`), which removes a branch the Rust side would otherwise implement for nothing. obs 18: a non-literal loop bound reports and continues; the definition is refused either way, and continuing reports more.

No fix changed the stored output of any fixture that existed before the round: the corpus never exercised the wrong answers. The fixes reach the kit only as new fixtures (the hardening suite's refusals and acceptances), which is the evidence that the old fixtures did not pin the defects. The round also closed the kit's coverage gaps with `coverage.test.ts`: every schema branch and every former's evaluation now has a fixture, except two ingest refusals that need R2-open features (`dayStampOutOfRange` needs the instant; `floorNotConfirmed` needs an owner `phaseAdvance` event). The exact zoom has no prose fixture because the describer has no exact zoom (EC-204, R7).

### R2: the evaluator and conformance (this version)

**What runs.** Everything below executes in `verify.sh` steps 3, 5, 6 and 7.
- `evaluate(term, ctx)` gives a value and a trace for all 47 formers. It is pure: every world read goes through a port the caller builds from stamped inputs, and the fact and calendar ports record what they read. It is total: every loop ranges over a finite value or a literal bound, and `app` refuses at runtime to enter a definition not published before its caller, so even a registry holding a refused definition cannot recurse (demo §3's mutual-recursion pair is now refused at `pong`'s example).
- Absence is flattened at runtime: a present optional value is its value, and `none` carries its cause (the checker guarantees no arithmetic meets it). The engine's `Value` lost `some` for that reason.
- A set target becomes a `Field`. It is fixed, or silent with the cause, or OPEN when it reads a performed set. An open field carries its bound term, a frame of every non-live read it makes (captured at issue) and its asPrescribed planned value. `resolveLive` evaluates the same term against the frame and the logged sets, so a live value is computed from the inputs the prescription used.
- `step` runs a closure's handlers against one pre-state, lands patches through the outcome policies, then advances the progress clock and emits weekEnd, cycleEnd and blockEnd in the same transition under their own causeKeys, each boundary reading the state the previous one left. `prescribe` reconciles through today (each dayClosed its own ledger entry) and issues on the reconciled head. `ingest` and `replay` make the ledger a set of causeKeys folded in ingestion order.
- `project` prescribes, synthesizes what was logged and steps, all on a copy, under asPrescribed, allMiss, repeatLast, asScheduled or a script. `projectMacro` runs phases in sequence: each phase is a new instance seeded only by its handoff, a bounded phase checks its gate from `min`, and at `max` it advances or asks. A peakOn macro lays its fixed phases out backwards from the date.
- `exampleFailed` is live. checkFn evaluates every FnDef example and checkScheme projects every SchemeExample at publication. All 14 FnDef examples and the one SchemeExample pass as written; none needed correcting.

**Construct counts.**

| construct | v3 | v3 + R2 |
|---|---|---|
| term formers | 47 | 47 (frozen) |
| compile-time refusal codes | 42 | 43 (+literalDomain) |
| ingest refusals | 4 | 7 (+instanceClosed, notOwnerWritable, rebindNeedsMigration); 8 after the semantics review round (+notALocalDay) |
| demo refusals / acceptances | 64 / 58 | 65 / 57 (the mutual-recursion example) |
| running tests | 0 | 43 former, 65 law, 16 conformance, 57 differential |
| test-plan rows dispositioned | 0 of 329 | 329 of 329 |

**R2 law decisions.** One line each. The 39 SPEC? rows of the test plan are tagged; "ratified" marks an owner decision already made (decisions memo, time model). **OWNER-RATIFIED 2026-10-04 as written**, every line below, except the three marked "owner-directed change 2026-10-04", which the owner changed rather than ratified: EC-146 (acceptance re-checks writability), EC-136 (RP allocation hands out weekly sets) and BV-25/BV-26 (one quantization law, ties down). Two athlete-visible lines carry their own "ratified" note: EC-144 (newer proposal supersedes) and the sub-grid-increment stall.
- EC-06: there is no division; a ratio over zero is absent (zeroDenominator).
- EC-30: a set count is never absent (refused at check); an evaluated count is floored and never negative.
- EC-69: allocate: a candidate missing from `into` starts at 0.
- EC-70, BV-18: allocate: a negative score still ranks; a cap gates, so a program excludes a candidate with a cap of 0.
- EC-71, BV-14: allocate floors `n`; the fraction is dropped and traced.
- BV-12: allocate with `n` ≤ 0 places nothing and removes nothing.
- EC-75: thresholds are literal and strictly ascending (v3 thresholdOrder).
- EC-79: a table row past its scale is refused (unknownName).
- EC-106: `working` judges every role except warm-up and recovery.
- EC-117: a transformer over an open field wraps its term and scales its planned value.
- EC-131: an owner edit may clear an optional field (recorded ownerCleared); clearing a required one is refused.
- EC-140: one patch record per handler, so a field is written once (v3 S2).
- EC-143 (ratified): a proposal is void once a field it proposes has moved since it was made.
- EC-144 (ratified 2026-10-04, athlete-visible): a newer proposal on a pending field supersedes the older one, and the supersession is recorded.
- EC-146 (owner-directed change 2026-10-04): the writer of record is the proposing handler, and the proposal records it. Accepting re-checks every proposed field's declared writers: the field must still list the proposing handler or `owner` (the owner's acceptance counts as an owner write). If any does not (a rebind changed its writers), the proposal is void, never applied, and `unwritable:key` is emitted. Was: acceptance applied the snapshot without re-checking.
- EC-151: an event `prescribed` read of an open field reads its resolution; an unresolved one is absent.
- EC-155 (ratified, v3 S1): the verdict is three-valued; an unlogged set is unknown, never a miss.
- EC-158: trainWeek counts the earlier weeks that are not deload or taper (a test week counts); in a deload it is the next train index.
- EC-161 (ratified): a once calendar ends in blockEnd with no cycleEnd, and prescribing past it is refused (programComplete).
- EC-166 (ratified, L11): the progress clock advances only on training, an owner skip, or an anchored week end.
- EC-172: the head is always derivable; replaying the ledger reproduces it byte for byte (tested), and persistence appends and updates atomically.
- EC-175: a rebind to a different state schema is refused (rebindNeedsMigration): the grammar has no record sort to write a migration in.
- EC-176: the current binding's handler runs against the issued snapshot; a step the snapshot lacks reads as absent.
- EC-186: an edited dependency yields a new, superseding Resolution; the old row stays.
- EC-192: repeatLast with no history falls back to asPrescribed and says so.
- EC-193: an unscripted session of a script projection is asPrescribed.
- EC-201: a library scheme's template holes must equal its params, as a library fn's do (templateHoles); a non-library `says` never renders.
- EC-214: an extra binding argument is refused (unknownName).
- EC-218 (v3): a slot has exactly one primary muscle. EC-226 (v3): a fixed phase needs a once calendar.
- BV-23, BV-24: a literal rounding step ≤ 0 is refused (literalDomain); an evaluated one leaves its operand unrounded, and the trace says so.
- BV-25, BV-26 (owner-directed change 2026-10-04): ONE quantization law for the language. Every nearest quantization, the sink's plate fitting and an author's `round` to nearest alike, sends ties DOWN, toward −∞ (101.25 on a 2.5 kg grid is 100; 7.5 reps to the nearest rep is 7). Why: one law, describable in four words ("ties round down"); conservative for loads, so the sink never prescribes more than it computed; and an author who reproduces the sink's math with `round` gets the engine's number. Was: `round` sent ties up and the sink down. The formulation is pinned so every implementation agrees bit for bit (units.ts `nearestStep`): with Q = 10⁹, u = x ÷ step and v = u × Q are the only floating-point operations (IEEE-754 binary64, in that order); m = v rounded half away from zero; n = ⌈(m − Q/2) ÷ Q⌉ in exact integer arithmetic; the result is n × step. A tie is therefore any u within half a billionth of a step of a half-integer (40.5 + 3×10⁻¹⁰ steps is a tie and goes down; 40.5 + 8×10⁻¹⁰ goes up). When |m| > 2⁵² the operand is returned unquantized. `round` down and up keep their floors (`floor(k + 1e-9)`, `ceil(k − 1e-9)`). (Corrected in the semantics review round, F13: "never prescribes more" holds for an exact bound and a ceiling; the sink now quantizes a floor UP and a ceiling DOWN, so a floor can be issued above what was computed, which honours it.)
- BV-40: nth floors its index; hold clamps into range and cycle takes the true modulus (−1 is the last); a literal negative or fractional index is refused (literalDomain).
- BV-46: zero judged sets is unknown, never a vacuous hit.
- BV-47: a session with no steps is refused (literalDomain).
- EC-136 (owner-directed change 2026-10-04): an allocation's gap is weekly, so what it hands out is weekly. A per-slot extra is added to EVERY session of that slot, so a slot that can receive extras must be trained once a week; a lift trained on two days is two slots. RP's cable fly is `cableFlyA` (upperA) and `cableFlyB` (upperB), each progressing its own load. Was: one `cableFly` slot on both days, so each extra set it won was issued twice a week. The checker does not enforce the once-a-week rule; a law test holds it over the worked corpus, and a lint is an R3 candidate.

The evaluator needed these too, beyond the test plan:
- A SILENT bound is not a bar and is not judged (no load could be computed, so the athlete chose one). An open field that never resolved is unknown.
- Effort is a dose instruction, not an outcome, so the verdict never judges it.
- A range on a lower-is-better metric (heart rate, pace) is a zone that is met inside it; on a higher-is-better metric its floor (or top) edge is the bar. An assisted load is better lower.
- A metric measured by a reduced fact (heart rate) is judged from the session's fact snapshot when the set did not log it.
- An event read of a step in a repeat block sees its last iteration, as a session read does; the verdict judges every iteration.
- A `prescribed` read takes the step's first set.
- The sink makes any value below zero or not finite silent (outOfDomain); a load of 0 is legal.
- scaleSets never adds a set to an empty line. capEffort, reshape and addSets act on judged sets; scaleMetric, scaleSets and setTempo act on every set.
- asPrescribed logs every set at the floor of its bound. allMiss logs one rep short where reps are targeted and 10% short otherwise. A projected session with nothing loggable is recorded as a skip, never as a phantom session (D3).
- Boundary handlers that close a session's week read the state the session left: they are separate events emitted in the same transition. An aggregate boundary runs if any slot trained in the window.
- Under anchored drift the dayClosed that ends a 7-day window closes the block week. periodClosed handlers run when a window's adherence is written.
- An abandoned instance refuses everything except a proposal decision (instanceClosed). A resume closes the open pause the day before.
- An e1RM read on a bodyweight-logged exercise needs bodyweight from the snapshot, or it is absent.
- A derived duration of a minute or more displays in minutes (pace × distance reads "23:45 min").
- (ratified 2026-10-04, athlete-visible) An increment finer than the program's grid moves the state but not always the prescription: the bench in prog/linear-3x5 adds 1.25 kg on a 2.5 kg grid, so it is issued 85, 85, 87.5 kg; the Achilles program adds 2.5 kg on a 1 kg grid and issues 2 kg. Both programs state their grid. A lint for an increment finer than its grid is an R3 candidate.

**Divergences found between prose and evaluation, and the side fixed.**
1. Linear-gated's hit handler says "set working weight to whichever is known first: (1) your working weight plus 2.5 kg; (2) the best load you logged". The evaluator judged a silent load target (no e1RM) as unknown, so the verdict was never `hit` and branch (2) could never run. Found by the law test for BV-57. The evaluator was wrong: a silent field is not a bar (judge.ts).
2. Three library scheme templates hid parameters the evaluator reads: 5/3/1's starting TM share (`tmPct`, 90%), the Jokers' TM, and the stabilization ladder's starting rung. The prose was wrong. The templates now name them, and the checker refuses a library scheme whose holes differ from its params (EC-201).
3. The composed policy prose multiplied set factors ("25% of the sets"), but the evaluator rounds down after each transformer. The corpus pair (50% then 50%) is exact for every set count from 1 to 64, so no corpus line changed, but 60% then 60% of 6 sets is 1 set, not 36% of 6 = 2. The describer was wrong in general. It now states one product only when the composition is provably exact, and otherwise "50%, then 60%, of the sets (each rounded down)" (`factorsCommute`). Differential C holds the stated combination to the evaluator for 1 to 12 sets.
4. Traces printed a logged load in kg inside a lb program, while the issued prose said lb. The evaluator's display was wrong: a context now carries the program's display units, so the APRE resolution reads "171 lb (190 lb (185 lb + 5 lb …) × 90%)".
5. Pace × distance printed seconds (a carried probe item). The display was wrong (units.ts `unitFor` now picks minutes for a derived duration).
6. The new issued-session renderer printed "at at most 4:45 per km". The renderer was wrong; it now uses the definition describer's lead rule.

The v3 tracer and the new `explain` agree: demo §5a's trace lines are byte-identical when produced by the evaluator, so the old arithmetic-only tracer was deleted.

**Program-level observations (not engine divergences, not changed).**
- An increment finer than the program's grid stalls the prescription: now a ratified decision (the list above).
- RP's allocation handed out PER-SESSION extra sets against a WEEKLY gap. Fixed in the ratification round (EC-136 above): the RP definition, not the engine.

**The two deferred Consider items, decided.**
- Unified read former: REJECTED. The evaluator already unifies reads at the layer where the item's motive (uniform stamping) lives: `Ports` has one member per world read, the fact and calendar ports record every read, and a frame captures any read node by its JSON (`READS` in evaluate.ts). In the grammar, a `read(source, …)` former would carry the same 11-way discriminant into every consumer: the checker's read cases are 113 lines because each read has its own capability, sort and key rule; the evaluator's are 35 lines; the describer's 22 lines are each a different noun phrase. Folding 11 formers into one would cut the former count to 37 without removing a line of that surface, and D1's per-former describer totality would have to be rebuilt over the source union.
- Allocate as a fold: REJECTED, with a prototype. conformance.ts builds allocation as a fold over `range(max)` that picks a slot and bumps its map entry. The checker refuses it, and its ONLY refusal is `notComparable: cannot compare slot == slot`: the grammar has no ref equality and no map update, so the fold cannot write the bump. Adding ref equality would make it expressible, but the result is worse on both sides. Its prose starts "Starting from your extra sets, for each item in turn: (if the total over the exercises that train chest directly of the extra sets so far for that exercise minus …", against allocate's "hand out the sets still to place, one set at a time and at most 8 in all, each to whichever … ranks highest by …". The fold also cannot trace dropped units, which RP's prose depends on. allocate costs 31 evaluator lines, 17 checker lines and 4 describer lines; keeping it is cheaper than any program that would replace it.

**Carried probe items, closed.** A literal rounding step of zero or below and a negative or fractional literal `nth` index are refused (literalDomain); their evaluated twins have a value (unrounded; floored and clamped or wrapped). Pace × distance displays in minutes. Library scheme template holes are checked against params.

**Conformance.**
- Publication: every worked definition checks clean with its examples evaluated, and a wrong FnDef example or SchemeExample is refused (exampleFailed).
- The capability matrix: all 121 cells (11 positions × 10 reads + an escaped binder variable) are checked against a SPEC table stated independently of the checker's GRANTS. A seeded GRANTS mutation fails it. A tsc-time assertion proves each GRANTS row equals the algebra's capability union for its position (EC-92).
- The checker suite: one IR negative per refusal class of the test plan.
- The differential (differential.ts). A: every literal the evaluator read, and every parameter value bound to a literal, appears in the description of the term that read it, and every number a program's description prints comes from the definition. A seeded describer bug that drops a range's top is caught. B: every number in an issued session's prose is a number of that fact, and every one appears. C: composed policy prose equals the evaluator's composition.
- The property suites. laws.test.ts covers L1 (200 random argument sets per library function), L2 (two projections of every program are identical), L3 (owner edits), L4 (handler order permutation, disjoint writes), L5 (duplicate causeKeys, replay equals the head, crash mid catch-up), L6 (a deep-frozen issued fact survives closing and resolving), L7 and E1 to E3 (silence propagates through a deload and a handler without invention), L8, L9 (projection leaves the input ledger byte-identical), L10, L11 (no training advances nothing; untrained boundaries keep; anchored weeks close on the calendar), L12 (replay with no fact source reproduces the head), L13.

**Disposition.** scratchpad/corpus/test-plan-disposition.md is generated by dispose.ts from the tests that ran. Of 329 rows (238 EC, 13 corpus-pending EC-C, 78 BV): 293 covered by R2 tests, 16 by suites that already existed, 14 re-homed to v3 constructs, 6 waived, 0 missing.

**Not finished (honest list).**
- Content hashing and de Bruijn elaboration (EC-212). The stamp carries an FNV-1a hash of the definition's JSON.
- WIDGETS, irSchema, describeDiff and the exact zoom (EC-198, EC-211, EC-210, EC-204) are R7 surfaces, still signatures.
- The issued fact does not carry a day's group shape (superset and circuit rest, EMOM rounds); groups only order the slots. The logger needs it at R7.
- No owner `phaseAdvance` event in the macro runtime: projectMacro decides advancement itself, and floorNotConfirmed is not exercised. peakOn's `startedLate` skip is not implemented.
- dayStampOutOfRange needs the instant, which only the boundary (R4) has.
- A rebind with a state migration is refused rather than implemented (no record sort).
- (Closed in the semantics review round, F2.) An open field's frame captured only reads whose variables were bound at issue; it now captures under closed keys through binders, and the checker refuses the one uncapturable read.
- The differential is numeric. It proves that numbers agree, not that the words around them are right; handler wording is held only by the tests that check behavior the prose names (BV-57 is the one that found a divergence).

### Fold round 3 (v3)

Every S-item landed. Where the package's shape forced an adaptation, it is recorded with its reason; nothing was dropped.

**Construct counts (obligation 4).** Recomputed by verify.sh step 4 for the first two rows; the rest are counted from the files.

| construct | v2 | v3 |
|---|---|---|
| term formers (DESCRIBERS is total over them) | 53 | 47 |
| compile-time refusal codes | 32 | 42 |
| outcome formers | 4 (commit, propose, keep, both) | 1 (patch) |
| lookup formers | 4 (bands, byLevel, schedule, mapLit) | 1 (table) |
| loop formers with a term bound | 1 (iterate) | 0; `range(n)` is a key list (+1 former) |
| event reads | 9 (hitAll and missedAny two-valued) | 8 (verdict three-valued) |
| state kinds | 6, labelled by the author | 3, derived from the sort |
| unit records / named dimensions / rate entries | 24 / 20 / 3 | 23 / 18 / 1 |
| TS negatives (each fires on its own line) | 31 | 41 |
| demo refusals / acceptances | 37 / 53 | 64 / 58 |

Net formers: −3 (outcomes) −3 (tables) −1 (iterate) +1 (range) = −6.

**S1. Three-valued verdicts.** Landed. `EventQuery.verdict { steps | 'working', bound }` replaces hitAll and missedAny; its IR sort is the built-in enum `verdict` (hit, missed, unknown), which `enumsWith` adds last so no definition can redeclare it, and which `cmp` refuses (`notComparable`). In the embedding its sort is a separate phantom `Verdict`, not an `En`, so `is`/`eq` cannot take it and `byVerdict` (lowering to the IR `match`) is its only consumer. The two-way silence punisher is refused in both: negative.ts `neg/verdict` and demo §3 "the two-way silence punisher". Every worked handler was rewritten three-way. Three change behavior because silence no longer counts as a miss: `lib/stab-ladder` (unknown keeps the solid streak; v2 reset it), `lib/pain-gated-loading` (unknown keeps; v2 reset flare-ups) and `prog/upper-hypertrophy-dc`'s stall counter (unknown keeps; v2 reset it to 0). The rest keep their v2 behavior, now written down: `lib/linear-gated`, `lib/gzclp-t1` and `lib/c25k` were already three-way, and `lib/rp-slot`, `lib/double-progression` and `lib/cluster-strength` already held the weight on anything short of a hit. The per-step form is the same read with an explicit step list (`lib/hr-tempo` judges only "tempo"). No `completed` boolean: no worked program needs one.

**S2. One patch outcome.** Landed. `{ k: 'patch', set: Record<field, { to, mode }> }`; keep is the empty patch; `both` is deleted and its JSON is refused (`unknownName: no former both`). Disjointness is structural: a patch is a record, so one handler cannot write a field twice, slot and program scopes own disjoint state, and policies never write; no separate check is needed because nothing is left to check (L4). The embedding keeps `commit`, `propose` and `keep` as sugar and adds `patch` with a `proposed(v)` marker per field. Two worked handlers now MIX modes, a behavior change: `lib/linear-gated` at its stall proposes the load drop and commits the miss-count reset, and `lib/531` at cycle end proposes the training-max reset and commits the AMRAP-flag reset (v2 put both fields in the proposal, so a declined proposal also kept the stale counter). Describers render per field: commits first, then "and propose, for your OK: …". `timeCommit` now fires per committed field of a periodClosed patch.

**S3. Policy semantics.** Landed. `ProgramDef.hitPolicy: 'allInOrder' | 'first'` (default allInOrder); `Policy.origin: role | allocation | declared`, checked against the one order (`policyOrder`); the phase transform's place (last) is in `prescribe`'s contract. Composed prose: for every subset of two or more policies of a channel that can co-fire, the description renders one combined result (demo §5h and §5i). `demotedBy` is a list. `roleDoubleEncoding` refuses a slot plan that branches on a role (a `pos.role` comparison, match or table) that a role policy with a plan also transforms. Adaptations:
- Hit policy is PER CHANNEL. The spec names one hit policy on the program; a single "first" across plan and outcome policies would let a cut-law outcome rule suppress a readiness deload, which nothing in the corpus wants. So `first` keeps the first matching plan policy and the first matching outcome policy.
- Static co-firing detection: two role policies on different roles are the only provably exclusive pair; every other pair may co-fire, including an always-on policy. Over-reporting a combination is safe (its line is true if it happens); under-reporting is the bug the review found.
- Composition: a plan `Use` whose body is a chain of scaleMetric, scaleSets, capEffort and stripIntensifier over literal arguments has a normal form (factors multiply, the effort floor is the max, strip is or), so co-firing deloads print as one result ("81% of the load, 25% of the sets"). Any other transformer is stated in order in the same sentence. The describer's normalizer is not an evaluator: it reads literal arguments only.
- The `when` of an outcome policy reads the event's stamped snapshot: stated on `Policy`, in L12, and on `step`; there is no running evaluator to show it (R2).

**S4. One table former; iterate cut.** Landed. `table(key, rows, otherwise, overflow)` with the reading selected by the key's sort (see Shape). The checker refuses a missing level or tag (`nonExhaustive`), a non-literal threshold (`boundNotLiteral`), a threshold not strictly above its predecessor, which covers dead and unsorted rows (`thresholdOrder`), and rows, otherwise or overflow that do not fit the reading (`tableShape`). The 5/3/1 waves (schedule sugar), the APRE chart (thresholds), the RP set-delta and SFR scores (ordinal) and RP's MEV/MRV (ref) are tables. `iterate` is deleted (fold over `range(n)` covers it; its JSON is refused). sum, count and pick stay. `allocate`'s semantics are normative on its former. Adaptations:
- Row keys are sort-free literals (`RowKey = number | string | Lit | null`): a level, a tag or id, a quantity with its unit, or null for a positional row. The embedding cannot know a key term's scale or ref kind when it builds the rows, so the key's sort supplies it at check time.
- `mapLit` is gone and `at` stays. A literal map is `tabulate(keys, k => table(k, rows, otherwise))` (RP's MEV init); a lookup in a literal map is a ref-keyed `table` (RP's MRV). `at` survives because programs look up maps they compute (RP's weekly target). `byTag` (unused) went with `mapLit`.
- `allocate`: re-rank per unit is FALSE. Scores are evaluated once, before the first unit; a score cannot read the map being built, so re-ranking could change nothing but cap saturation, which the candidate filter ("still below cap") already handles. Ties break by `among` order; undeliverable units are dropped and traced; a literal `n` above `max` is refused (`nExceedsMax`).
- The embedding spells tables with one overloaded `table` (ordinal, thresholds, ref) and `schedule` (the clock reading). An enum-keyed table is IR-only; the embedding spells it `match` (demo §3c).

**S5. Single typing authority and IR hole closures.** Landed. The IR checker is the authority (algebra.ts header, Shape); negative.ts keeps the TS-refused ⇒ IR-refused contract with 41 directives and their twins, and demo §3c is the converse corpus. Closures:
- Clock sorts: a quantity sort carries `clock: progress | calendar` from its read. Arithmetic, ratio and comparison across clocks are refused (`clockMix`); a rate literal per day or per week is refused (`clockRate`, and the embedding's rate table has no clock rate); a calendar-derived quantity at any sink (a state write, a target, an argument, an index) is refused (`clockMix`). `cal.count` against `pos.slotSession` is refused. Probes 4, 4b and 4c of the review and a laundering variant (a calendar count committed into state) are in demo §3.
- Transformers typed by logging: a session sort carries its exercise's possible logging types and its targeted metrics. `swapExercise` refuses a target the new exercise does not log (`loggingMismatch`); `reshape`, `scaleMetric` and `capEffort` run `metricNotLogged` when the logging is known. The squat-to-plank swap, the loaded plank reshape and the paced squat are refused.
- Mixed-logging ladders: `Ty.ref.logging` is a set; a ladder's targets check against the intersection of what its types log. v2's IR accepted any target on such a ladder; v3 refuses a load on the OPT push ladder in the IR as the embedding always did.
- Literal canonicalization: literals store `v` (canonical) and a display unit; the trace adds canonical values ("102.268 kg (100 kg + 5 lb)"); `rpe(n)` lowers to RIR with `notation: 'rpe'` for display, and the affine unit is gone. The field is renamed n → v so that no consumer could keep reading an authored number as canonical.
- `cmp` on an Opt reports `absenceUnhandled`, as arithmetic does.

**S6. StateKind derived.** Landed. `kindOf(ty)`: mass → load, sets → volume, else plain (through opt and map). The `kinds` field is gone from schemes and aggregates; an author who writes it gets a TS excess-property error, and a JSON label is ignored (demo §3: "its kind is load, the cut law reaches it"). Adaptation: `lib/hr-tempo`'s tempo block was labelled volume in v2 and is plain in v3 (it is a duration). That is the derivation working as specified; it means the cut law's `volumeKeep` no longer protects a tempo block.

**S7. Prose honesty.** Landed:
- `says` renders only for library definitions. Library means an id under `lib/`, for every definition kind. Every worked program and macro is under `prog/` or `macro/`, so each is described by a generated headline (days, exercises, block weeks) and their author blurbs no longer render (demo §5k shows the c25k pair).
- A user definition's `named` noun renders as "noun [expansion]"; a library one renders bare at intent zoom and "noun [= expansion]" at mechanism zoom.
- Structured nesting and the four ambiguities: see Describability. Demo §5j prints each probe pair; none collide.
- Two clock vocabularies; `dueText` prints "not before {day}" for the `notBefore` verdict.
- The budget is relabeled a lint; match is costed per row; IR `let` requires a label (`unlabeledLet`); a `named` noun in a non-library definition costs 1.
- Exercise labels are dropped from the IR (the recommended option); `labelMismatch` therefore does not exist. Muscle and slot refs never carried meaningful labels and render their ids.
- The shipped wrong template is fixed ("a bad morning cuts each exercise to two sets": 67% of 3 sets rounds down to 2 per exercise, 4 in all), and the cycle-end clause is derived from the calendar the slot runs in ("after its deload week" only where the last block week is not a train week).

**S8. Calendar fixes.** Landed: `lastOn` takes the later of the stored and the new day; every selector a program reads through `cal.gap`/`cal.recent` is collected (`checkdefs.calReads`, mirrored as `Elaborated.reads.selectors`) and tracked with `any` and the frequency selectors; `dueVerdict` returns `notBefore(today + horizon + 1)` when its search fails, the first day it did not prove blocked; selector keys canonicalize muscle sets; grids are per metric and optional (load or distance), checked against the metric's dimension. The programs that issue no load (C25K, the tempo block, the Achilles isometrics, OPT stabilization) lost their v2 "1 kg load grid"; the Achilles loading program keeps a 1 kg load grid because it targets added load.

**S9. Small closures.** Landed: a slot-keyed fact refuses a muscle key; an outcome rule naming a kind no field has is refused (`noSuchKind`); index bases are stated once (Laws) and `cal.occurrence` (1-based) is now `cal.earlierToday` (0-based); `range(n)` is a former (demo §5l builds a 12-week wave from it); the day-selection trust boundary and the embedding-drift risk are written down (Laws, Risks).

**Spec ambiguities resolved.**
1. "Keep a completed boolean only if some program genuinely needs it": none does, so there is none.
2. "match exhaustiveness forces the unknown arm": the verdict reuses the IR `match` and the embedding adds `byVerdict`; a table keyed by the verdict is exhaustive too and therefore allowed.
3. "a structural check over record keys": the record type IS the check; there is no runtime check because a JSON object cannot repeat a key and scopes are disjoint by construction.
4. "Default all-in-order WITH composed prose": composed per channel, over every co-firing subset of size two or more (four lines for the upper-hypertrophy program's three plan policies).
5. "One total application order, stated and checked": checked over `origin`; the phase transform is applied by `prescribe` after all policies and is stated there, since a phase transform lives on the macro, not the program.
6. "table subsumes … mapLit+at": mapLit is removed; `at` is kept for computed maps (above).
7. "re-rank per unit (pick one)": false (above).
8. "pos.* and cal.* reads get distinct SORTS": a clock tag on the quantity sort, with the stricter calendar sink rule (above). `cal.recent` sums and maxima are calendar-sorted too; `ev.week` is progress-sorted.
9. "IR literals store canonical value + display unit at elaboration": the embedding's builders canonicalize, so every IR literal is canonical from birth; JSON authors write canonical `v` (demo §3's JSON edits do).
10. "named nouns outside the library glossary charge 1": there is no glossary object; "outside the library" is read as "in a definition not under lib/".
11. "user programs get a generated headline": all worked programs are user programs by namespace; re-namespacing the canonical methods as library programs is a publishing decision, not a language one, and is left open.
12. "the converse corpus": demo §3c, not a separate file: three JSON-authored constructs the IR accepts (an enum tabulate, an enum-keyed table, a calendar threshold table) each with its TS twin or listed gap, plus the §7 extension as the documented drift gap.
13. "within(): canonicalize selector sets (sort)": exactly that; muscle-subset containment was not added.
14. `notBefore`'s day: the first day the search did not prove blocked, so the prose is a true lower bound.

**Carried to R2 (with reasons).**
- A unified read former (fact, event, performed, prescribed, cal as one `read(source, …)`). Deferred: its value depends on how the evaluator dispatches reads and stamps them; deciding it before `evaluate` exists would guess at the stamping shape.
- Allocate as a fold. Deferred: with re-ranking fixed to false, allocate IS expressible as a fold over a sorted candidate list once the evaluator can show the trace survives; until then the dedicated former keeps the "dropped units" trace that RP's prose depends on.
- From the probes, outside the spec: a literal rounding step of zero, a negative or fractional literal `nth` index, and the display of pace × distance (it prints seconds) are still accepted; the evaluator's domain checks are the natural home.
- A library scheme's template holes are not checked against its params (5/3/1's template omits `tmPct`).

### Fold round 2 (carried; superseded where round 3 says so)

Every amendment landed. Where the package's shape forced an adaptation, it is recorded here with its reason.

**A. Metric registry.** Landed as specified: registry with dimension, shapes, `loggedBy` (with mass semantics for load), `measuredBy`, direction and prose; metric-keyed targets, `performed`, `prescribed`, event reads (`metric` with pick last/best/worst/sum/count), issued targets, resolutions and performed sets; enum-keyed maps (`byTag`, enum `keys`, an `at` overload); `weekly` aggregates by slot, muscle or tag over sets or any metric; group scores and a `groupScore` event read; the EMOM fixed-count rule, scoped off by `untilFail` (death-by); metric-aware xforms (`scaleMetric`; `lib/deload` has a `timed` parameter, 100% leaves timed work untouched); `capEffort` refused on a session whose exercise logs no effort. Adaptations:
- A set target is a nested `target` record (`set({ target: { reps, load }, rest })`). A flat record intersected with the extras breaks tsc's key inference.
- AMRAP is `reps: atLeast(n)` with role `amrap`. The spec's "atLeast + open" is read as "no ceiling".
- hitAll and missedAny now treat an unlogged value as unknown. That changes behavior: `lib/linear-gated` and `lib/gzclp-t1` became three-way (hit, miss, neither → keep), and `lib/c25k` is written that way, so an unlogged session no longer counts as a miss. This is D2 and D3 applied to the handlers.
- A ladder whose rungs log differently (the OPT push ladder mixes bodyweight and loaded rungs) types as a logging-type union, and the embedding's `Logs<L>` is the intersection: such a ladder may target only reps. The IR checker cannot express a union in `Ty`, so it accepts targets on a mixed-logging list without checking them. Known imprecision.
- Technique-group volume weighting (0.5 per later stage, cluster 1.0) is documented on `AggQuery` and is the evaluator's job; no running slice evaluates it.

**B. Policy former.** Landed: `Policy { when, plan, outcome }`, `OutcomeRule { demote: { kinds, direction }, volumeKeep }`, `StateDecl.kind`. Week roles are builder sugar lowered to policies; `ProgramDef` has no `roles` field. Worked: the cut law and readiness day-down (`prog/upper-hypertrophy-dc`), a reactive deload over program state (same program), D4 as a builder default. Adaptations:
- `StateKind` gained `flag` beside the spec's five. A boolean field (5/3/1's "an AMRAP fell short") is none of load, volume, counter, ladder or stage.
- D4 is a default policy (`when: true`, demote any change to volume-kind fields) that the program builder appends when the aggregate has volume-kind state, unless the program passes `allocation: 'commit'`. It renders as "Always: any change to your set counts is proposed for your OK instead of applied."

**C. Replay determinism.** Landed in engine.ts types: `ClosedFacts.facts` carries the snapshot, `Env.facts` reads only it in handler positions, `Stamp.factsRead/calReads` and `Transition.factsRead/calReads` record every read with its value. L12 states the law. No running slice evaluates handlers, so this is a contract, not executed code.

**D. Facts registry.** Landed as specified, including reducers with prose, freshness, the observed axis and the new facts. Adaptations:
- Pain is two facts, `pain` (postSession) and `morningPain` (preSession), because a fact has one observation time and the rehab protocols read both clocks.
- `dietPhase` is a standing fact, readable from plans by the `fact` capability. Separately, the `program` former now reads scalar program fields as well as slot-keyed maps (`PlanCtx.programScalar`), which closes the hole the spec names. No worked program exercises the scalar read; the checker path is implemented but not demonstrated.

**E. Exports and the seed channel.** Landed: `ProgramDef.exports` (slot-state exports), `LIFECYCLE_EXPORTS` on every instance (completedFraction, missedTotal, finalWeek, status), `ProgramDef.imports`. Worked: `prog/gzclp-t1` seeds its squat from `prog/linear-3x5`'s `squatLoad`. Adaptation: an import is a program PARAM of Opt sort bound at activation from the predecessor's export, not a new read former. The checker verifies the name and type against the exporter; an optional export feeds an optional param (absence collapses). Macro handoff is documented as sugar over the same channel and keeps its typed syntax.

**F. Units.** Landed: unit records with prose, pace, bpm with beats as a base dimension, angle, kcal, km, mi, hours, days, the two perceived-exertion scales, `asReps` scoped to library bodies, vector-derived trace display. Adaptations:
- An explicit-vector literal is a rate of two registered units (`rate(2.5, 'kg', 'rep')`, IR `{unit, per}`), not a raw vector. A raw vector would carry no prose; a rate always can. The compound units kgPerRep, lbPerRep and kgPerWk are gone as a result.
- The TS division table is gone, not kept. D10 removed the only consumer (the `div` builder), so the table was dead. Mul stays as embedding sugar; the IR checker remains authoritative for every vector.
- `lib/load-for` (inverse Epley) is now `e1rm × ratio(30, 30 + reps + RIR)` and returns Opt. Its callers moved to `knownThen`.

**G. Session structure.** Landed: literal `repeat` blocks with telescope scoping, work/recovery roles (`recovery` joined the setRole enum), step handles with `read`, `sum`, `count` and `prescribed`, self-reads in until and while targets, `stepWhile` (5/3/1 Jokers, `lib/531-jokers`), the `cluster` field, the stage event read, `superset{between, after}`, `restOwnedByGroup`, count ranges (First Set Last), author-declared enums (`declareEnum`; GZCLP's stages left the global interface). Adaptations:
- The `cluster` technique kind is removed. A cluster on every set is the set field; the dose law keeps one intensifier per session, so the technique form could only cluster the final set, and keeping both would give one training idea two encodings that count differently.
- `lib/stab-ladder` lost its own 60 s rest, because it sits in OPT's circuit and superset, which now own rest. The checker refused it until it was removed.
- Group rest terms (superset, circuit, emom, amrapFor) are checked at the literal-only position, so they cannot read params. No corpus program needs a computed group rest.

**H. Time model.** Landed as the memo's §3 deltas: day dimension and unit, `cal` capability and former, `Selector`, `Frequency` with the three forms and `CadenceCap`, rotation `pattern` and `daily`, `Calendar.drift`, `ProgramDef.frequency/lapseAfterDays`, `periodClosed`, `Length.bounded.atMax`, `peakOn` requiring anchored drift, `Instance`, `Head` with progress, reconciledThrough, lastOn and the calendar facts, `ClosedFacts.localDay/occurrence/startedEarly`, `Stamp.issuedOn/calReads`, `Due`, `Expectation`, `Adherence`, `AdherenceAmendment`, the lifecycle events, `reconcile`, `prescribe(…, today)`, `Assume.asScheduled`, L11 to L13, the five refusals. Beyond the memo's sketch, time.ts RUNS: feasibility, default frequency, activation, reconciliation, adherence with amendments, pause voiding, lapse, completedFraction, the due verdict, and the emptySession refusal at occurrence construction. Adaptations:
- Feasibility is pairwise: each atLeast against each cap whose selector contains it, over one cyclic hyper-period. Containment is known only for `any` and equal selectors, so an overlap the checker cannot prove is never refused. A conflict that needs three declarations at once is not searched.
- Selectors resolve only when a program is in view. A scheme's own calendar reads with slot selectors are checked when the scheme is checked inside a program.
- The clinician "not before day N" gate is a time floor inside `advanceWhen` plus `atMax: propose`, and the owner override is the `phaseAdvance` event with `confirmFloor`; `floorNotConfirmed` refuses only the unconfirmed form.

**Decision defaults.** D2: no rule reads adherence as a progression input; layoff rules read `cal.gap` explicitly. D3: emptySession at ingest, demonstrated. D4, D5, D10 (no division; `ratio` instead), D11 and D12: landed as above. D8: `lib/linear-gated` is the library default; the import of the live program is an implementation-plan concern, recorded as a constraint, not code. Memo defaults: pauses void the window they touch (demonstrated), lapse at 21 days with no auto-archive, ad-hoc sessions count toward `cal.gap` and never toward adherence (demonstrated), clinician gates warn and confirm.

**Spec ambiguities resolved (round 2).**
1. Amendment A lists `power` in the registry, and obligation 4 adds it as the extension proof. Power is left out of the base registry and is the demo's one-entry extension; its dimension and unit (W) are in the base because `ftp` needs them.
2. The `hrv` fact is a dimensionless score, so the extension's diff surface is exactly two registry entries and needs no new unit.
3. Spec F keeps the TS Div table; D10 removes division. D10 wins, and the dead table went with it.
4. Spec G says the telescope-steps encoding of rest-pause is "not the blessed form". It is not refused, only unblessed: nothing stops an author writing three steps, and volume would count them as three sets.
5. The time memo §4.4 says four hard runs a week two days apart fit (days 0, 2, 4, 6). Under the cyclic reading "every week" requires, they do not: day 6 to the next week's day 0 is one day. The checker refuses 4 and accepts 3, and demo §6 prints the correction. The memo should be amended.
6. The memo writes "legs 3 times per rolling 7 days" but rejects rolling expectations. Worked as the memo's own resolution: a tumbling `atLeast` for misses plus a rolling `cal.count` read for live coaching.
7. NHS Couch to 5K weeks 5 and 6 vary by day. Each rung is the week's first-day shape; a per-day ladder would be 27 rungs and is a data change, not a model change.


Round 3 supersedes these round-2 statements: hitAll/missedAny (now the verdict), the `flag` StateKind and the labelled kinds (now derived), `byTag` and enum-keyed `at` (removed with `mapLit`), the mixed-logging ladder "known imprecision" (closed), the IR literal's authored `n` (now canonical `v`), and the single `grid` (now `grids`).

### Checker closures

Closed in round 2, each with an IR negative in demo §3: published-before and recursion (EC-88), primary muscle exactly one (EC-218), bounded min ≤ max, open phase last (EC-230), EMOM fixed count (EC-221, EC-C13), role-policy and phase-transform `Use` args typed (EC-223, EC-237), fixed phase over a `once` calendar (EC-226), declared-enum exhaustiveness, import names and types. Closed in round 3: the verdict's three arms, clock sorts and clock rates, logging-typed transformers, mixed-logging ladders (intersection), threshold literalness and order, allocate's n against its bound, labeled lets, role double-encoding, dead outcome kinds, policy order, slot-keyed facts, comparison on Opt.

Not closed (R2 closed example evaluation, the phase transform's place, and Use-hole metric checks at runtime; see R2):
- Content hashing and de Bruijn elaboration.
- `whenWritten`'s calendar arithmetic.
- Metric checks on sessions passed as parameters are static only where the session is a literal; at runtime a transformer never writes a metric the exercise does not log (xform.ts).
- Feasibility beyond pairs.

### Round 2 (carried from v1, still true)

Capability phantom with `NoInfer`-wrapped builder caps; `named` and the budget inside the IR `infer`; `writableBy` as writing handlers plus `'owner'`, with the TS patch mapping unwritable fields to `never`; literal allocate bounds; open fields and Resolution facts; `prescribed` reads; the discriminated refusal taxonomy; the running checker and describer. Known imprecision kept: a binder discharges `elem` wholesale in the embedding; the IR checker scopes variables exactly.

### Verification

Rerunnable with `./verify.sh`:
1. tsc strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` is clean over all 37 files.
2. All 41 `@ts-expect-error` directives in negative.ts fire on their own line when stripped.
3. `tsx demo.ts` matches `demo.out.txt`: 66 refusals and 57 acceptances, covering every worked definition, the budget, the IR negatives, the converse corpus, the composed policy prose, the four ambiguity probes, the time derivation, the extension proof, and (§8) the evaluator: six programs' first two weeks under asPrescribed with what changed, worked traces, a live APRE resolution, and both macros run forward.
4. The construct counts: 47 term formers (from DESCRIBERS) and 43 compile-time refusal codes (from engine.ts).
5. The property suites pass: semantics.test.ts (the formers), laws.test.ts (L1 to L13), hardening.test.ts (the typing-observation fixes) and coverage.test.ts (the kit's coverage gaps).
6. Conformance passes: conformance.ts (publication, the capability matrix, the checker suite, the Consider prototype) and differential.ts.
7. The disposition is complete and matches what ran (dispose.ts).
8. The language handoff kit (`../../handoff`) regenerates from the suites, validates against its schema, and every fixture replays on the oracle.

## Migration note

`workouts` gains `local_day date NOT NULL` for new rows, stamped by the client at session start. History is backfilled from `started_at` with the zone the client reports at its first post-migration launch and flagged `local_day_inferred`; that is a labeled guess. Expectations are never issued before an instance's activation, so inferred days affect only early `cal.gap` and `cal.recent` reads, never adherence. `programWeek` keeps meaning the progress week, now 0-based in the language (the app's display stays 1-based). The instance anchor and status become columns on the block entity. The imported Volume Cut program activates on import day with slide drift and the rotation-derived default frequency. Exercise references are wger or custom ids already; the registry is the app's exercise table, read at check and describe time.

## Open questions and risks

Carried forward:
- Q1. The live Volume Cut program: import with a one-time parity check plus a projection dual-run of the remaining block weeks (decisions memo D1), or the round-1 shadow window?
- Q2. Should the app ever auto-propose a regression after missed weeks, or is that always the layoff rule read at the next session (D2's open edge)?
- Q3. Pause granularity: voiding forgives a whole window for a one-day pause; proration produces fractional sessions. Default is void.
- Q4. Lapse: 21 days, with an archive prompt only. Confirm both.
- Q5. Session-level caps (cardiac rehab HR and Borg ceilings that can end a session, D13) stay plan-level described constraints until the logger shows HR live.
- Q6. Budget calibration: re-run the lint on ten real authored programs before changing 4.
- Q7 (new). Which worked programs, if any, are LIBRARY programs whose own words should render (S7 ambiguity 11)?

Risks:
- Refusal quality decides LLM authorability. The TS-side writableBy and peakOn messages are opaque; the IR refusals are the repair channel.
- Embedding drift. Two rule implementations can drift, and round 3 made the split explicit: the IR is the authority and the embedding is best-effort. Every rule the embedding carries needs a TS negative and an IR twin; every rule it does not carry is listed in negative.ts's header; every JSON-only construct the IR accepts needs a TS twin or a line in the converse corpus. A vocabulary extension is the sharpest edge: a new metric or fact is one registry entry for the IR but also needs its TS interface entry before the embedding can name it (demo §7 is that gap, by design).
- The vocabulary is runtime data. An extension entry with a wrong dimension or wrong prose is checked only by its consumers; registry entries need review like library definitions.
- Composed policy prose is only as complete as the transformer normal form: a new kind of plan transformer falls back to ordered prose until the normalizer learns it.

## Next implementation step

R3: land the package in the repo with vitest ports of verify.sh's seven steps (the suites already name their test-plan rows, so the disposition regenerates from vitest output), the negatives as type tests, and the lint ratchet. Carry in: the grid-coarser-than-increment lint, the RP allocation units fix in its definition, content hashing, and the issued group shape the logger will need.
