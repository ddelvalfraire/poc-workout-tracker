# Training-program algebra: BVT + ECT test plan

Source of truth: `arena2/synthesis/` (algebra.ts closed unions, engine.ts laws L1–L10, structure.ts, checker.ts, describe.ts, programs.ts, negative.ts, demo.out.txt). Every row derives from a union member, a law, or a checker rule. Where the spec does not decide the expected outcome, the row says **SPEC?** and proposes the answer the laws point to. Those rows need a decision before the test can be written.

## Coverage legend

| Tag | Meaning |
|---|---|
| **N** | `negative.ts` (TS `@ts-expect-error`, enforced by `verify.sh` step 2) |
| **D** | `demo.out.txt` (IR checker, budget, analysis or prose, enforced by `verify.sh` step 3) |
| **P** | Positive control only: a worked program uses it and demo §1 reports it OK. This is static, nothing is evaluated |
| **T** | Structural via tsc (mapped type / `satisfies`). A missing entry fails to compile |
| **X** | An executable spec exists (FnDef `examples` / SchemeDef `examples`) but nothing runs it: `exampleFailed` and `evaluate` are unimplemented. **Counts as a GAP** and is the cheapest kind to close |
| **GAP** | Untested |

**Counts.** 238 equivalence classes (EC-01–EC-238) and 13 corpus-pending placeholders (EC-C01–C13). 78 boundary values (BV-01–BV-78). Gaps, including X and partly covered rows: 199 of 238 EC and 74 of 78 BV. Only 39 EC and 4 BV are fully covered. Inside EC-94, 52 of the 58 denied capability cells are untested. 39 rows are marked **SPEC?**: the laws do not decide the outcome, and a decision is due before the test is written.

Runtime law rows (L2, L4–L7, L9, L10) are all GAP or X today, because `evaluate`, `prescribe`, `step`, `ingest`, `resolveLive` and `project` are `notImplemented`.

---

## 1. Equivalence classes

### 1.1 Sorts and units (lit, arith, cmp, logic, not, round, asReps)

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-01 | `+ - min max` same dim | result same dim | P |
| EC-02 | `+` across dims (kg + reps) | `unitMismatch` | N, D (kg/rep + reps) |
| EC-03 | `*` to a named Dim (kg/rep × reps) | mass | P (juggernaut-bump) |
| EC-04 | `*` to an unnamed vector (kg × kg) | TS: unit error. IR: accepted as {mass:2}, then `unitMismatch` at first use as mass | N (TS); IR half GAP |
| EC-05 | `/` same dim → dimensionless | q[one] | P (load-for) |
| EC-06 | `/` by a literal or evaluated zero | **SPEC?** L1 needs a value. Proposed: a load sink turns non-finite into silent `outOfDomain`. An exact-zero literal divisor is refused at check | GAP |
| EC-07 | arith on an ordinal (soreness + pump) | `notComparable` (ordinals never add) | N; IR GAP |
| EC-08 | arith on `Opt` operand | `absenceUnhandled` | N; IR GAP |
| EC-09 | reps + rir without `asReps` | `unitMismatch` | N; IR GAP |
| EC-10 | `asReps(effort)` | q[reps], cost 0 | P (load-for) |
| EC-11 | `asReps` on non-effort | `unitMismatch` | GAP |
| EC-12 | cmp q/q same dim; ord/ord same scale | bool | P |
| EC-13 | cmp ord vs q, or ord of different scales | `notComparable` | GAP |
| EC-14 | cmp enum `==` | bool | P (5/3/1 role) |
| EC-15 | cmp enum `<` | `notComparable` | GAP |
| EC-16 | logic/not on non-bool | `unitMismatch` (expected bool) | GAP |
| EC-17 | round: mode down/nearest/up × step same dim | q[d] | P (macro handoff, nearest) |
| EC-18 | round step of a different dim | `unitMismatch` | GAP |
| EC-19 | lit units: kg/lb/rep/set/s/min/m/rir/rpe/pct/x/wk/kgPerRep/lbPerRep/kgPerWk/mps | canonical value, authored unit kept for display (lb shows lb) | GAP (no evaluator) |
| EC-20 | rpe literal (affine tenMinus) | canonical RIR = 10 − n | GAP |

### 1.2 Absence and silence (some, none, known, knownThen, orElse; L7)

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-21 | `known(present)` | some(body) | X (rp-weekly-target ex.1) |
| EC-22 | `known(absent)` | none, cause carried from the operand (`inputUnknown` / `stateUnset` / `notPerformed` / `emptyPick` / `missingKey`) | GAP |
| EC-23 | `knownThen` body not optional | `unitMismatch` ("knownThen body must be optional") | GAP |
| EC-24 | `known` on a non-Opt | `unitMismatch` | GAP |
| EC-25 | `known2` with one absent | none, cause from the absent side. If both are absent, the cause is the FIRST operand's | X (rp-weekly-target ex.3, sfr-or-neutral ex.1) |
| EC-26 | `orElse(opt τ, τ)` | τ, and the fallback is described | X |
| EC-27 | `orElse(opt τ, opt τ)` | opt τ (chain) | P (rp-slot handler) |
| EC-28 | `orElse` with non-Opt left | `unitMismatch` | GAP |
| EC-29 | Silence propagates to a set's load sink | issued `loadKg: {k:'silent', cause}`, trace names the leaf cause, no default invented | GAP |
| EC-30 | Silence in a set COUNT | **SPEC?** A count must be q[sets], so Opt is refused at check (`absenceUnhandled`). Confirm there is no runtime path | GAP |
| EC-31 | Silence in an exercise choice (`IssuedSlot.exercise: {silent}`) | slot issued with silent exercise, steps still issued | GAP |
| EC-32 | Out-of-domain at the sink (load ≤ 0, RIR < 0, reps < 0, non-finite) | silent `outOfDomain{field,value}` | GAP |

### 1.3 Control and naming (let, named, if, match)

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-33 | unlabeled `let` | not a name boundary: value cost adds to parent | GAP |
| EC-34 | labeled `let` | name boundary: value budgeted alone, renders "call this X" | P, D (RP "MRV is …", "Next week's target is …") |
| EC-35 | `named(noun, e)` | identity value. e budgeted alone; parent pays 0; renders "Where {noun} is …" | D (RP) |
| EC-36 | `if` cond non-bool | `unitMismatch` | GAP |
| EC-37 | `if` branches of different sorts | `unitMismatch` at `b` | GAP |
| EC-38 | `match` exhaustive | ok | P (GZCLP) |
| EC-39 | `match` missing tag | `nonExhaustive{missing}` | N; IR GAP |
| EC-40 | `match` extra/unknown tag | `unknownName` | GAP |
| EC-41 | `match` on non-enum | `notComparable` | GAP |

### 1.4 Finite collections (list, nth, fold, tabulate, at, mapLit, keys, sum, count, pick, iterate)

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-42 | `list` empty vs non-empty | `nonEmpty` = items.length > 0 | P |
| EC-43 | `nth` on a possibly-empty list | `unitMismatch` ("nth needs a non-empty list") | GAP |
| EC-44 | `nth` index sort: one / weeks / other | one, weeks ok; others `unitMismatch` | P (one); GAP rest |
| EC-45 | `nth` overflow hold vs cycle | hold → last; cycle → i mod len | GAP |
| EC-46 | `fold` accumulator ground | ok | P (RP) |
| EC-47 | `fold` accumulator `upd` | `nonGroundAccumulator` | GAP |
| EC-48 | `fold` step sort ≠ acc sort | `unitMismatch` | GAP |
| EC-49 | `tabulate` over refs | map[K,τ] | P (RP) |
| EC-50 | `tabulate` over non-ref list | `unitMismatch` | GAP |
| EC-51 | `at` key present / missing | some / none(`missingKey`) | GAP |
| EC-52 | `at` key of the wrong RefKind | `unitMismatch` | GAP |
| EC-53 | `mapLit` empty | sort `any`, unifies with the declared map | P (RP extra init) |
| EC-54 | `keys` slots/muscles | program declaration order | GAP |
| EC-55 | `sum` empty | 0 of the body's dim | GAP |
| EC-56 | `count` empty / none match / all match | 0 / 0 / len | GAP |
| EC-57 | `pick` max/min × where null / filters all / filters some | where filters all → none(`emptyPick`). Ties by declaration order (L2) | GAP |
| EC-58 | `pick` score not q/ord | `notComparable` | GAP |
| EC-59 | `iterate` times ≤ max | runs `times` steps | GAP (no program uses iterate) |
| EC-60 | `iterate` times > max | runs exactly `max` (literal cap) | GAP |
| EC-61 | `iterate` max non-literal | `boundNotLiteral` | GAP |
| EC-62 | Binder variable escapes its binder | TS: `elem` not granted. IR: `unknownName` (unbound var) | N; IR GAP |

### 1.5 Allocation (`allocate`)

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-63 | candidates non-empty, n < total headroom | greedy: each unit to the top score with current+given < cap | GAP |
| EC-64 | `among` empty | all n dropped, reported in trace | GAP |
| EC-65 | every candidate at cap | all dropped, reported | GAP |
| EC-66 | score tie | first in `among` order (slot declaration order) (L2) | GAP |
| EC-67 | n > max | max units placed, rest dropped, reported | GAP |
| EC-68 | `max` given as a term | `boundNotLiteral` | N, D |
| EC-69 | `into` has no entry for a candidate | **SPEC?** Proposed: current = 0 (not silence; `into` is a total accumulator) | GAP |
| EC-70 | negative score (sfrScore can be −9) | **SPEC?** Is a negative-scored candidate still eligible? The current text says yes (argmax only). A pain-flagged exercise would then still get sets when it is the only candidate | GAP |
| EC-71 | n not a whole number of sets (weeklySets with 0.5 contributions) | **SPEC?** Proposed: floor(n) units; the fraction is dropped and reported | GAP |
| EC-72 | sort errors: n not sets, into not map[slot,sets], score not one, cap not sets | `unitMismatch` at that path | GAP |

### 1.6 Tables (bands, byLevel, schedule)

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-73 | `bands` key in row k (inclusive upper bound) | row k value | X (apre-adjust ex.) |
| EC-74 | `bands` key above all rows | `otherwise` | GAP |
| EC-75 | `bands` rows not ascending | **SPEC?** Rows are terms, so this cannot always be checked statically. Proposed: refuse when all `upTo` are literals and not ascending | GAP |
| EC-76 | `bands` key non-quantity | `unitMismatch` | GAP |
| EC-77 | `byLevel` exhaustive | ok | P |
| EC-78 | `byLevel` missing level | `nonExhaustive` | N; IR GAP |
| EC-79 | `byLevel` extra level (formQuality row 3, readiness row 0) | **SPEC?** The checker silently accepts it today. It should refuse with `unknownName` | GAP (checker bug) |
| EC-80 | `schedule` zero rows | `nonExhaustive{missing:['row 1']}` | GAP |
| EC-81 | `schedule` outside a `pos`-granting position | `capabilityEscape{pos}` | N (fn/init via pos); schedule-specific GAP |
| EC-82 | `schedule` rows of mixed sort | `unitMismatch` | GAP |

### 1.7 Reuse (`app`, named definitions; D2, L1)

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-83 | app with args = params | result sort, cost 0 (name boundary) | P, D (juggernaut handler cost 2) |
| EC-84 | app missing arg | `missingArg` | GAP |
| EC-85 | app extra arg | `unknownName` | GAP |
| EC-86 | app arg of the wrong sort | `unitMismatch` at args.x | GAP |
| EC-87 | app of an unpublished id or version | `futureRef` | GAP |
| EC-88 | **app of itself / mutual recursion / a LATER version** | `futureRef` (DAG by publication time, L1) | **GAP. checker.ts accepts it**: the registry is the whole module, so "published before" is never enforced |
| EC-89 | fn body reads anything but params | `capabilityEscape` | N (pos); IR GAP |
| EC-90 | example args/gives read context | `capabilityEscape` (example grants nothing) | GAP |
| EC-91 | example evaluates ≠ gives | `exampleFailed` | GAP (unimplemented) |

### 1.8 Capability matrix (cap × position; algebra §4, checker `GRANTS`)

G = granted, x = must refuse with `capabilityEscape{cap,position}`. A cell suffix gives coverage (`:N`, `:D`, `:ND`). A cell with no suffix is a GAP.

| cap \ position | fnBody | init | plan | live | handler | aggregate | bind | handoff | example |
|---|---|---|---|---|---|---|---|---|---|
| param | G | G | G | G | G | G | G | x | x |
| state | x | x | G | G | G | G | x | x | x |
| peer | x | x | G | G | G | x | G | G | x |
| program | x | x | G | G | G | x | x | x | x |
| input | x | G | G | G | G | G | x | x | x |
| pos | x:N | x:N | G | G | G | G | x | x | x |
| performed | x | x | x:N | G | x | x | x | x | x |
| event | x | x | x | x:ND | G | G | x | x | x |
| agg | x | x | x:ND | x | x | G | x | x | x |
| elem | x | x | x:N | x | x | x | x | x | x |

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-92 | checker `GRANTS` equals algebra §4 cap unions (InitCap … HandoffCap) | a drift test: both encodings list the same caps per position | GAP |
| EC-93 | each G cell | accepted (positive control per cell) | P for the cells the programs use. Cells unused by any program (handler·program, aggregate·pos, bind·param) GAP |
| EC-94 | each x cell (58 cells) | `capabilityEscape` at the read's IR path (`unknownName` for an escaped `elem` var in IR) | 6 covered (above); **52 GAP**. Write one table-driven test |
| EC-95 | commit/propose/keep outside a handler | `capabilityEscape{cap:'event'}` | GAP |
| EC-96 | **handoff arg reads `peer … of:'current'`** (the phase being initialised) | must refuse: args read only `prevPhase` | **GAP. checker.ts accepts it** (its `peers` resolves both `of` values in handoff) |
| EC-97 | **advanceWhen reads `of:'prevPhase'`** | must refuse: gates read only the current phase | **GAP. same checker hole** |
| EC-98 | **keyed input with a null key** (`input e1rm` without an exercise) | `unitMismatch` / `missingArg` | **GAP. checker.ts returns null with NO error pushed** (`expect(null)` is silent), so the definition reports OK |
| EC-99 | input not in the definition's `inputs` | `undeclaredInput` | GAP (aggregate scope accepts any input by design, rationale) |
| EC-100 | unkeyed input given a key | refusal ("not keyed") | GAP |

### 1.9 Domain formers (set, RepSpec, session, telescope, xform, technique, tempo)

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-101 | RepSpec exact / range / amrap / timed | issued `reps` Field of that kind | P (all but timed); timed GAP |
| EC-102 | RepSpec operand of the wrong dim (timed with reps, exact with sets) | `unitMismatch` | GAP |
| EC-103 | set load present / absent (null) / Opt-silent | fixed / no load field / silent with cause | P; runtime GAP |
| EC-104 | set effort: effort / reps | ok / `unitMismatch` | N (reps); IR GAP |
| EC-105 | set rest: time / other; tempo: tempo / other | ok / `unitMismatch` | GAP |
| EC-106 | set role × 5 (warmup/working/backoff/amrap/test) | role carried to the issued target. **SPEC?** which roles count as "working" for `hitAll/missedAny steps:'working'` | GAP |
| EC-107 | target reads `performed`/`prescribed` of an EARLIER step | open field, `dependsOn=[step]` | P (APRE) |
| EC-108 | target reads a LATER step | `forwardStepRef` | D |
| EC-109 | target reads ITS OWN step | `forwardStepRef` | GAP |
| EC-110 | target reads a non-existent step | `unknownName` | GAP |
| EC-111 | count reads performed | `capabilityEscape{performed, plan}` | N; IR GAP |
| EC-112 | `stepUntil` stop reads its own step | allowed (own ∈ earlier for stop only) | GAP (no program uses it) |
| EC-113 | `stepUntil` max non-literal | `boundNotLiteral` | GAP |
| EC-114 | session intensifier present / absent | at most one, on the final set of the last working step (structural) | GAP (**no worked program uses `technique`**) |
| EC-115 | technique kinds × 4 (drop-set, rest-pause, myo-reps, cluster) | stages are sets. Describer per kind | GAP |
| EC-116 | xform op × 8: arg sort right / wrong / missing | ok / `unitMismatch` / `missingArg` | P (scaleLoad, scaleSets, capEffort, stripIntensifier, setTempo, setReps); swapExercise, addSets GAP; negatives GAP |
| EC-117 | xform over an OPEN field (scaleLoad on an APRE back-off) | **SPEC?** Proposed: the transform wraps the open term; `planned` and the resolution both see the scale | GAP |
| EC-118 | xform over a silent field | stays silent, cause unchanged | GAP |
| EC-119 | tempo literal | dom tempo, rendered `e-p-c-t` | P |

### 1.10 State declarations (StateDecl; init, writableBy; L3)

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-120 | init from param | value | P (stab ladder) |
| EC-121 | init from lit | value | P |
| EC-122 | init fromE1rm, input present | `loadFor(e1rm, …)` / `e1rm × tmPct` | X (linear-gated example) |
| EC-123 | init fromE1rm, input absent | none(`inputUnknown e1rm`) → silent loads | GAP |
| EC-124 | init `none` (self-anchoring) | unset until the first session's best load | P (rp-slot) |
| EC-125 | init reads pos / state | `capabilityEscape` | N (pos); state GAP |
| EC-126 | patch field writable at this event | applied | P, D (§4 writeSet) |
| EC-127 | patch field not listed for this event | `notWritableHere{field,writer,writableBy}` | N, D |
| EC-128 | patch names a field the scope does not own | `notOwner` | GAP |
| EC-129 | owner edit, 'owner' listed | applied, attributed `edit:` | GAP |
| EC-130 | owner edit, 'owner' not listed (RP `extra`, linear `misses`) | refused | GAP |
| EC-131 | owner edit cannot express `none` (patch is `Lit`) | **SPEC?** An owner cannot clear an Opt field such as a TM. Decide whether `Lit` gains `none` | GAP |
| EC-132 | writeSet ⊆ writableBy | analysis lists each (field, event, outcome) | D (5/3/1, RP) |
| EC-133 | field with `writableBy: []` | constant after init. A patch naming it is refused | GAP |

### 1.11 Handler semantics (commit / propose / keep / both; L3, L4)

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-134 | handler reads PRE-state (two fields where one depends on the other's new value) | reads the old value. 5/3/1 cycleEnd reads `missed` before reset | GAP |
| EC-135 | several scopes fire on one event | same pre-state, disjoint writes, any permutation gives the same `after` (L4) | GAP |
| EC-136 | aggregate `plannedSets/weeklySets` while a slot handler on the same event changes that slot | aggregate sees PRE-state plans | GAP |
| EC-137 | commit | patch applied now; `reason` = condition-path trace | GAP |
| EC-138 | propose | patch values SNAPSHOT into `pendingProposals`; state unchanged | GAP |
| EC-139 | keep | `fired` entry with outcome keep; state unchanged; transition still recorded | GAP |
| EC-140 | both(commit, propose) | one commit applied plus one proposal. **SPEC?** same field in both: checker does not refuse. Proposed: `bothOverlap` refusal | GAP |
| EC-141 | proposalDecided accepted | snapshot applied (never re-derived), proposal removed | GAP |
| EC-142 | proposalDecided rejected | proposal removed, state unchanged. Note: linear `misses` and 5/3/1 `missed` resets live INSIDE the proposal, so a rejection leaves the streak/flag set and the next event re-proposes | GAP |
| EC-143 | **stale proposal**: the field changed by a commit after the proposal was made | **SPEC?** Accepting the old snapshot would overwrite newer progress (linear: deload proposed at miss 3, next session hits and +2.5, then the user accepts). Proposed: proposals carry `stateSeq` and are void once a proposed field has moved | GAP |
| EC-144 | second proposal for the same field while one is pending | **SPEC?** replace vs queue | GAP |
| EC-145 | decision for an unknown/already-decided proposalKey | no-op, recorded | GAP |
| EC-146 | proposal acceptance and L3 | **SPEC?** The patch was checked against the proposing handler's event, but it is applied at `proposalDecided`. Confirm the writer of record (the proposing handler, via the snapshot) | GAP |

### 1.12 Events and EventQuery (handler reads)

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-147 | hitAll floor vs top, steps list vs 'working' | judged against ISSUED targets (L6) | P |
| EC-148 | missedAny | bool | P |
| EC-149 | reps/load/effort picks (last/best/worst/min) | opt; none(`notPerformed`) if unlogged | P; runtime GAP |
| EC-150 | e1rm (Epley over the best set) | opt mass | GAP |
| EC-151 | event `prescribed` from the stamp (fixed / silent / open-unresolved / open-resolved) | fixed → some, silent → none. **SPEC?** open-unresolved: proposed none(`notPerformed`); open-resolved → the Resolution value | GAP |
| EC-152 | feedback about muscle / slot / null(session); rated / unrated | some(level) / none | P; runtime GAP |
| EC-153 | trained(muscle) | bool | GAP |
| EC-154 | event step id not in the plan | `unknownName` | GAP |
| EC-155 | **hitAll/missedAny with a partially logged session** (2 of 3 sets) | **SPEC?** hitAll says "every set reached its minimum". An unlogged set: did not reach (→ false) or unknown? 5/3/1 treats an unlogged AMRAP as NOT a miss. Pick one rule for hitAll, missedAny and the reps picks | GAP |

### 1.13 Schedule and calendar (pos, schedule clock, week roles; L10)

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-156 | clock week vs trainWeek | week counts every week; trainWeek skips deload/taper | P (5/3/1, RP use trainWeek); week GAP |
| EC-157 | overflow hold vs cycle | hold → last row; cycle → mod | P (both used); runtime GAP |
| EC-158 | trainWeek DURING a deload/taper week | **SPEC?** Not defined ("index among weeks NOT deload/taper"). Proposed: the next train index (count of prior train weeks) | GAP |
| EC-159 | test week counts as a train week | yes per definition (only deload/taper excluded) | GAP |
| EC-160 | calendar `cycle`: cycleEnd after the last listed week | one cycleEnd per pass, causeKey `cycle:prog:n` | GAP |
| EC-161 | calendar `once`: after the last week | blockEnd fires once. **SPEC?** does cycleEnd also fire? Proposed: no. Prescribing past the end: refuse vs hold | GAP |
| EC-162 | role policy Use applied by role (8 roles) | only roles in `roles` map transform | P (RP deload); runtime GAP |
| EC-163 | role policy, then phase transform order | deload first, then repShape (prescribe order) | GAP |
| EC-164 | L10 intensifier × role | stripped in deload/taper/test; kept in train/intro/accumulation/intensification/realization | GAP |
| EC-165 | rotation weekly vs alternate(perWeek) | weekly: each listed day once/week. alternate A/B perWeek 3: A B A then B A B | GAP |
| EC-166 | **calendar advance without training** (weeks elapse, no sessions) | **SPEC?** prescribe "catches up calendar events". If weeks are date-driven, 5/3/1 cycleEnd bumps the TM on zero training. Proposed: the clock advances on COMPLETED training weeks (matches the app's completed-only counting) | GAP |

### 1.14 Ledger (L5; ingest, step, Head)

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-167 | new causeKey | `applied`, seq+1 | GAP |
| EC-168 | duplicate causeKey, identical payload | `already{seq}`, head untouched | GAP |
| EC-169 | duplicate causeKey, DIFFERENT payload | `already` (first wins). Should log a conflict | GAP |
| EC-170 | replay ledger from empty | head == stored head (exact replay) | GAP |
| EC-171 | late ingestion (week-2 session after week-3 weekEnd) | applied at ingestion position, never retroactive. Later transitions untouched | GAP |
| EC-172 | crash after the ledger append, before the head snapshot | head recomputed from the ledger equals the uncrashed head. **SPEC?** append + head update atomic, or head always derived | GAP |
| EC-173 | crash between two catch-up events (weekEnd applied, cycleEnd not) | re-running prescribe applies only the missing one (causeKeys) | GAP |
| EC-174 | rebind, same state schema | identity migration | GAP |
| EC-175 | rebind, changed schema, migration null | **SPEC?** must refuse | GAP |
| EC-176 | event issued under def v1, closed after rebind to v2 | **SPEC?** which handler runs; stamp carries schemeHashes | GAP |
| EC-177 | **sessionClosed with zero logged sets (the empty-finish case)** | must be REFUSED at ingest (new refusal, e.g. `emptySession`) or carry no transition. Today every progression would misfire (see BV-61) | GAP |

### 1.15 Issuance and resolution (L6; prescribe, resolveLive, currentView)

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-178 | Field fixed | quantized value | GAP |
| EC-179 | Field silent | cause carried, no ghost | GAP |
| EC-180 | Field open | term + `planned` (under asPrescribed) + dependsOn | GAP |
| EC-181 | prescribe twice, same issueKey | returns the stored fact unchanged, even if state moved meanwhile | GAP |
| EC-182 | same day issued twice in a week (weekly ['A','A','A']) | distinct `occurrence` in issueKey | GAP |
| EC-183 | resolveLive, dependency logged | one new Resolution per open field; issued fact untouched | GAP |
| EC-184 | resolveLive, dependency not logged | no row (stays open; not guessed) | GAP |
| EC-185 | resolveLive re-run with `already` | no new rows (idempotent) | GAP |
| EC-186 | dependency set EDITED after resolution | **SPEC?** Resolution is immutable and re-resolve is a no-op, so the back-off stays computed from the old top set. Proposed: a superseding Resolution keyed by a logged-set version | GAP |
| EC-187 | currentView = issued ⊕ resolutions | open fields replaced by resolved values | GAP |
| EC-188 | stamp contents | programHash, schemeHashes, stateSeq, digest, position, inputsRead (each read with observedAt), rolePolicy, phaseTransform | GAP |
| EC-189 | inputsRead lists only the inputs actually read | e.g. 5/3/1 week 2 reads e1rm only at init, not at issue | GAP |

### 1.16 Projection (L9; project)

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-190 | assume asPrescribed | every set hits; AMRAP = min; feedback neutral; `performed` = the target | X (linear-gated scheme example) |
| EC-191 | assume allMiss | linear: proposal after `stalls` sessions | GAP |
| EC-192 | assume repeatLast with no prior session | **SPEC?** proposed: falls back to asPrescribed, tagged so | GAP |
| EC-193 | assume script with weeks missing | **SPEC?** proposed: unscripted sessions asPrescribed | GAP |
| EC-194 | every projected week | `projected: true`; ledger byte-identical before/after | GAP |
| EC-195 | projection over a macro (bounded phase) | both bounds shown; phase advance by advanceWhen under the assumption | GAP |

### 1.17 Describability (D1–D4, L8)

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-196 | DESCRIBERS total over 51 formers | compile error if one is missing | T |
| EC-197 | each former's describer renders without throwing | a golden phrase per former | D for ~30 formers used by programs. **GAP for iterate, count, sum, pick, technique, swapExercise/addSets xforms, both, timed reps, not, match (in prose), mapLit-in-handler** |
| EC-198 | WIDGETS total | compile error if missing | GAP (`declare const` only, no implementation) |
| EC-199 | template holes == params | ok | D (all lib fns OK) |
| EC-200 | template extra hole / missing hole | `templateHoles{extra,missing}` | GAP |
| EC-201 | **scheme/program/macro `says` holes** | **SPEC?** not checked at all (checkFn only). A stray `{x}` renders literally | GAP |
| EC-202 | non-`lib/` definition | " (author's wording)" marker | GAP (implemented, every demo def is lib/) |
| EC-203 | intent vs mechanism zoom | intent stops at app; mechanism unfolds one level | D (Juggernaut, RP) |
| EC-204 | exact zoom | unfolds everything | GAP (describe.ts has no 'exact') |
| EC-205 | trace cut at app with arguments' values | "worked: 7.5 kg (2.5 kg per rep × 3 reps …)" | D |
| EC-206 | repeated absence fallback stated once | "anything unknown counts as 0 sets" | D |
| EC-207 | tables render rows | "65/70/75%" | D |
| EC-208 | binder noun from collection sort | "that muscle", "that exercise" | D |
| EC-209 | transition reason = condition-path trace (no free-text why) | "why didn't my weight go up" answered from `reason` | GAP |
| EC-210 | describeDiff between versions | sentences per changed node | GAP |
| EC-211 | irSchema: quantity literals require `{n, unit}` | a bare number is rejected by the schema | GAP |
| EC-212 | content hash stable under binder renaming | building a def twice gives the same hash (de Bruijn) | GAP |

### 1.18 Program structure

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-213 | slot binding missing a scheme param | `missingArg` | GAP |
| EC-214 | slot binding extra arg | **SPEC?** silently ignored today; should be `unknownName` | GAP |
| EC-215 | bind arg reads a peer of the right / wrong sort | ok / `unitMismatch` | P (BBB); wrong GAP |
| EC-216 | peer slot or field does not exist | `unknownName` | GAP |
| EC-217 | slot meta muscle undeclared | `unknownName` | GAP |
| EC-218 | **slot meta with no primary (contribution 1)** | **SPEC?** "exactly one primary" is unchecked. `prog/opt-power` `pass` has only `chest: 0.5`, so it passes today | GAP (live instance in programs.ts) |
| EC-219 | day group names an unknown slot | `unknownName` | GAP |
| EC-220 | group kinds × 5 (single/superset/circuit/emom/amrapFor) | interleaving metadata; slots keep their targets | P (single, superset, circuit); emom, amrapFor GAP |
| EC-221 | slot inside `emom` with a non-fixed count | refuse (structure.ts promises it) | GAP (not in checker.ts) |
| EC-222 | role Use not session→session | `unknownName` | GAP |
| EC-223 | **role Use args (type / missing)** | `unitMismatch` / `missingArg` | GAP (checkProgram never checks Use args) |
| EC-224 | slot `program` read with no aggregate / non-slot-keyed field | `unknownName` | GAP |

### 1.19 Macro (phases, anchors, handoff)

| ID | Class | Expected | Cov |
|---|---|---|---|
| EC-225 | fixed phase | length = its program's `once` calendar | P |
| EC-226 | fixed phase whose program calendar is `cycle` | **SPEC?** must refuse ("must be once"). Unchecked | GAP |
| EC-227 | bounded min<max | advance at the first weekEnd ≥ min where advanceWhen; force at max | GAP |
| EC-228 | bounded min=max | exactly min weeks; advanceWhen irrelevant | GAP |
| EC-229 | bounded min>max | must refuse. Unchecked | GAP |
| EC-230 | open phase last / not last | ok / must refuse (TS tuple type only; IR unchecked) | GAP |
| EC-231 | peakOn with a bounded/open phase | TS error; IR `peakNeedsFixed` | N; IR GAP |
| EC-232 | peakOn layout | calendar laid out backwards from the date | GAP |
| EC-233 | handoff arg from prev terminal state, present | value | P (OPT) |
| EC-234 | handoff, prev value absent | none flows to the param (e.g. benchStart none → e1rm seed → self-anchor) | GAP |
| EC-235 | handoff from a slot the previous phase lacks / first phase reads prevPhase | `unknownName` | GAP |
| EC-236 | handoff missing a program param | `missingArg` | GAP |
| EC-237 | phase transform Use args | type-checked | GAP (checkMacro skips `transform`) |
| EC-238 | state never crosses a phase except by handoff | the next phase's init sees only args + inputs | GAP |

---

## 2. Boundary values

| ID | Boundary | Input | Expected | Cov |
|---|---|---|---|---|
| BV-01 | budget | cost 3 | accepted | P |
| BV-02 | budget | cost exactly 4 (`lib/load-for`: ÷ + ÷ +) | accepted | D |
| BV-03 | budget | cost 5 (inlined Juggernaut; RP unnamed gap) | `overBudget{cost:5,budget:4,fix}` at the patch path | D |
| BV-04 | budget | cost-5 expr wrapped in `named` | refused INSIDE the named (named does not launder); parent pays 0 | GAP |
| BV-05 | budget | cost-5 value under an UNlabeled let | refused (unlabeled let is no boundary) | GAP |
| BV-06 | budget | clause children (set fields, counts, patches) each at 4 | each accepted independently | P |
| BV-07 | allocate max | 0 | `boundNotLiteral` (literal must be ≥ 1) | GAP |
| BV-08 | allocate max | 1, n=3 | 1 placed, 2 dropped + reported | GAP |
| BV-09 | allocate max | 8, n=8 / n=9 | 8 placed / 8 placed, 1 dropped | GAP |
| BV-10 | allocate max | 2.5 | `boundNotLiteral` | GAP |
| BV-11 | allocate n | 0 | `into` unchanged, nothing reported | GAP |
| BV-12 | allocate n | negative, unclamped | **SPEC?** proposed: 0 units, never removes | GAP |
| BV-13 | allocate n | clamped via `max(0, gap)` with gap −3 | 0 (RP path) | GAP |
| BV-14 | allocate n | 1.5 (half contributions) | **SPEC?** proposed 1 placed, 0.5 reported | GAP |
| BV-15 | allocate cap | current+given = cap−1 / = cap | takes one more / refuses | GAP |
| BV-16 | allocate | all candidates at cap 4 | all n dropped | GAP |
| BV-17 | allocate | two candidates score 3 vs 3 | first declared | GAP |
| BV-18 | allocate | only candidate scores −9 (joint pain 3) | **SPEC?** see EC-70 | GAP |
| BV-19 | clamp | `min(max(x,lo),hi)` with lo = hi | lo | GAP |
| BV-20 | clamp | lo > hi (`min(max(x,5),3)`) | 3: composition order decides; no clamp former | GAP |
| BV-21 | cap at MRV | rpWeeklyTarget now 21, soreness 0, pump 0 (+2) | 22 (capped) | X (ex.2) |
| BV-22 | cap at MRV | now 25 > MRV 22 (owner-edited) | 22: the min REDUCES the target. Confirm intended | GAP |
| BV-23 | round | step 0 | **SPEC?** proposed: literal 0 refused at check; evaluated 0 → silent `outOfDomain` | GAP |
| BV-24 | round | step negative | **SPEC?** same as BV-23 | GAP |
| BV-25 | round nearest | exact half: 101.25 on 2.5 | **SPEC?** tie rule (half-up vs half-even); OPT handoff uses nearest | GAP |
| BV-26 | sink quantize | 101.25 kg on a 2.5 kg grid | **SPEC?** grid rounding mode unspecified | GAP |
| BV-27 | sink quantize | 5 lb grid, canonical kg (TM 100 kg × 65%) | quantized in lb space (65 kg → 145 lb), stored canonical | GAP |
| BV-28 | sink | load computes to ≤ 0 (APRE top 20 lb, reps 2 → −10 lb, ×90%) | 9 lb → quantized; 0/negative → silent `outOfDomain` | GAP |
| BV-29 | week | week 0 / trainWeek 0 | schedule row 0 (5/3/1: 5 reps @65/75/85%) | GAP |
| BV-30 | week | last train week (trainWeek 2) | row 2 (5/3/1: 5/3/1+ @75/85/95%) | GAP |
| BV-31 | week | the deload week (week 3, role deload) | 5/3/1 deload branch 40/50/60% × 5; BBB 3 sets | GAP |
| BV-32 | week | first week after deload (week 4, next cycle) | TM = T + inc (cycleEnd applied BEFORE issuing); wave row 0 | GAP |
| BV-33 | week | week-4 session issued BEFORE cycleEnd ingested | prescribe must catch up first. Otherwise a stale TM is a bug | GAP |
| BV-34 | week | cycle wrap: schedule cycle, 3 rows, trainWeek 3 | row 0 | GAP |
| BV-35 | week | hold, 4 rows, trainWeek 4 (RP deload week) | row 3 (RIR 0) → then capEffort ≥ 4 → 4 | GAP |
| BV-36 | week | `once` calendar, week 5 of a 5-week block | blockEnd. Prescribe past the end per EC-161 | GAP |
| BV-37 | rotation | alternate A/B perWeek 3, weeks 1–2 | A B A / B A B | GAP |
| BV-38 | nth | rung = len−1 (2 of 3), hold | last element | GAP |
| BV-39 | nth | rung = len (3), hold / cycle | last / element 0 | GAP |
| BV-40 | nth | rung −1 / 1.5 | **SPEC?** proposed: floor; negative clamps to 0 (hold) or mod (cycle). Unspecified | GAP |
| BV-41 | ladder | rung at top (2), climb condition met | min(3, top 2) = 2, solid reset 0 | GAP |
| BV-42 | telescope | step 0 reads performed of anything | `forwardStepRef` (exists later) / `unknownName` (absent) | GAP |
| BV-43 | stepUntil | max 0 | `boundNotLiteral` | GAP |
| BV-44 | stepUntil | max 1 | exactly 1 set; stop never consulted for a 2nd | GAP |
| BV-45 | stepUntil | stop true after set 1 / never true | 1 set / max sets | GAP |
| BV-46 | empty working line | step count evaluates to 0 sets (rp-slot base 0, extra absent) | step issued with 0 sets. `hitAll` over zero sets: **SPEC?** (vacuous true would progress on nothing) | GAP |
| BV-47 | empty session | `session` with `steps: []` | **SPEC?** accepted by the checker today. Proposed: refuse at check | GAP |
| BV-48 | scaleSets | 1 set × 50% | 1 (never below 1) | GAP |
| BV-49 | scaleSets | 5 × 60% (BBB deload) | 3 | GAP |
| BV-50 | scaleSets | 3 × 50% | 1 (rounds down) | GAP |
| BV-51 | capEffort | target effort absent / 1 / 5, floor 4 | 4 / 4 / 5 | X (deload ex.: absent → 3) |
| BV-52 | RPE→RIR | rpe 10 | rir 0 | GAP |
| BV-53 | RPE→RIR | rpe 6.5 | rir 3.5 | GAP |
| BV-54 | RPE→RIR | rpe 11 (rir −1) at the sink | silent `outOfDomain{effort}` | GAP |
| BV-55 | RIR 0 | `asReps(rir 0)` in loadFor(e1rm 120, 6 reps) | 120 / 1.2 = 100 | GAP |
| BV-56 | loadFor | e1rm 120, 5 reps, rir 1 | 100 | X |
| BV-57 | e1RM absent | linear init | load none → silent targets "e1RM unknown" → first hitAll session self-anchors at `ev.load('work','best')` | GAP |
| BV-58 | e1RM absent + no load logged | linear session hitAll | load stays none (orElse of two nones) | GAP |
| BV-59 | ordinal extremes | rpSetDelta soreness 0 × pump 0/1/2/3 | 2/2/1/1 | X (0,1 only) |
| BV-60 | ordinal extremes | soreness 3 (any pump) / soreness 2 / soreness 1, pump 3 | 0 / 0 / 0 | GAP |
| BV-61 | **zero logged sets** (empty finish) | sessionClosed, every slot's performed empty | Expected: refused at ingest (EC-177). Without a guard: linear hitAll vacuous→ +inc; or false → misses+1 → deload proposed after 3 empty closes. GZCLP → stage regresses to 6x2 on nothing. Stab ladder → solid streak moves. 5/3/1 → no change (known2 → none → `no`), the only safe one | GAP |
| BV-62 | misses streak | stalls 3, misses 1, miss | commit misses 2 | GAP |
| BV-63 | misses streak | stalls 3, misses 2, miss (exactly the stall) | propose load×0.9 + misses 0 (pending) | GAP |
| BV-64 | misses streak | proposal from BV-63 rejected, then miss | misses still 2 → propose again (EC-142) | GAP |
| BV-65 | stall count | stalls 1 | the first miss proposes | GAP |
| BV-66 | two-muscle slot | contributions chest 0.5 + triceps 0.5 | weeklySets(chest) += 0.5 × plannedSets. Slot in NO `slotsFor` (no primary) | GAP |
| BV-67 | Juggernaut | AMRAP = standard (10) | bump 0 | GAP |
| BV-68 | Juggernaut | 13 / 8 | 7.5 kg / 0 | D (trace), X |
| BV-69 | APRE bands | reps 0, 2, 3, 4, 5, 7, 8, 12, 13 | −big, −big, −small, −small, 0, 0, +small, +small, +big | X (9, 2 only) |
| BV-70 | APRE open field | top not logged; back-off issued | open, planned = rm × 90% (adjust(6) = 0) | GAP |
| BV-71 | 5/3/1 AMRAP | s3 reps = prescribed / prescribed − 1 / unlogged | missed unchanged / true / unchanged | GAP |
| BV-72 | GZCLP | retest, test load not logged | keep; retest prescribed again | GAP |
| BV-73 | bounded phase | advanceWhen true at weekEnd 2 (< min 4) | stay | GAP |
| BV-74 | bounded phase | true first at weekEnd 4 (= min) | advance | GAP |
| BV-75 | bounded phase | never true | advance after week 6 (= max) | GAP |
| BV-76 | handoff arithmetic | prev bench 100 kg → round(115%, 2.5) | 115 kg; 101 kg → 116.15 → 115 | GAP |
| BV-77 | L10 | intensifier in the realization week vs the deload week | kept / stripped | GAP |
| BV-78 | ledger | same causeKey ingested 2× / 3× | 1 transition | GAP |

---

## 3. Ranked GAP list (the test backlog)

Ranked by (chance a wrong program reaches a user) × (damage to their state). "Checker hole" means a check you can write today against `checker.ts`, which currently passes the bad input.

| Rank | IDs | Gap | Why it ranks here | Kind |
|---|---|---|---|---|
| 1 | EC-177, BV-61, BV-46, EC-155 | **Zero-logged-set close and the unlogged-set rule for hitAll/missedAny** | The same bug as the app's empty-finish incident, in a new engine: every progression scheme except 5/3/1 corrupts state on an empty close, and the language has no single rule for "unlogged = miss or unknown". Needs a spec decision plus an ingest refusal | spec + runtime |
| 2 | EC-88 | **Self-/mutual-/forward-version `app` accepted** | Breaks L1 totality. A JSON-authored recursive fn passes the checker, and `evaluate` would not terminate | checker hole |
| 3 | EC-166, BV-32, BV-33 | **Calendar clock vs training; cycleEnd timing vs issuance** | Date-driven catch-up bumps a 5/3/1 TM without training. Issuing before cycleEnd gives a stale TM in the first post-deload week | spec + runtime |
| 4 | EC-143, EC-144, EC-142, EC-146 | **Stale or duplicate proposals** | Accepting an old snapshot overwrites newer progress. Rejection leaves streak flags set and re-proposes forever. L6 says "apply the snapshot" with no staleness rule | spec + runtime |
| 5 | EC-96, EC-97, EC-98 | **Handoff/advanceWhen `of` not enforced; keyed input with a null key passes silently** | IR authoring (coach/MCP) can read uninitialised state across a phase boundary or ship an unkeyed e1RM read, and the checker reports OK | checker hole |
| 6 | EC-94 | **52 of 58 denied capability cells untested** | The capability system is the main safety claim of the design. One table-driven test closes it | checker test |
| 7 | EC-91, all X rows | **Examples are not evaluated** (`exampleFailed`) | 14 worked examples are free executable specs (linear 107.5 kg, rp-weekly-target, apre, juggernaut, deload). Lowest cost per bug found | evaluator |
| 8 | EC-170–173, EC-168–169 | **Ledger replay, idempotence, crash recovery** | L5 is the persistence contract. No test proves replay equals head, or that duplicate causeKeys are no-ops | runtime |
| 9 | EC-181–187, BV-70 | **Issuance immutability and Resolution idempotence** | L6. The issueKey and Resolution contract decides whether a ghost changes under the athlete. Includes the edited-dependency rule (EC-186) | runtime |
| 10 | EC-63–72, BV-07–18 | **Allocation semantics** | Fractional n from 0.5 contributions, negative scores and the missing-`into` default are unspecified, and RP volume depends on all three | spec + runtime |
| 11 | EC-218, BV-66 | **Slot with no primary muscle** | A live instance (`opt-power` `pass`) passes today. It is never allocated, and its weeklySets counts silently | checker hole |
| 12 | EC-06, BV-23–28, EC-32 | **Division by zero, round step 0, half-grid ties, sink domain** | L1/L7 need a value for each. Load quantization is user-visible on every set | spec + runtime |
| 13 | EC-158, BV-29–36 | **trainWeek in deload weeks, cycle wrap, once-calendar end** | Undefined index for deload weeks. Off-by-one risk on every periodised plan | spec + runtime |
| 14 | EC-114, EC-164, BV-77 | **Intensifier and L10 never exercised** | No worked program uses `technique`. The dose law is untested end to end | runtime |
| 15 | EC-223, EC-237, EC-226, EC-229, EC-230, EC-221 | **Unchecked structure** (Use args, phase transform, fixed⇒once, min>max, open-not-last, emom fixed count) | Each is promised in prose or the TS types and absent from the IR checker | checker hole |
| 16 | EC-140, EC-135, EC-136 | **both() overlap; L4 commutation; aggregate pre-state** | Order independence is asserted, not tested | runtime |
| 17 | EC-117, EC-118, EC-163 | **xform over open/silent fields; policy-then-phase order** | Deload on an APRE back-off is unspecified | spec |
| 18 | EC-79, EC-201, EC-214, EC-200 | **Silent acceptance**: extra byLevel rows, scheme `says` holes, extra bind args, template holes | Prose and authoring hygiene. Cheap checker tests | checker hole |
| 19 | EC-190–195 | **Projection** honesty and assumption gaps (repeatLast with no history, partial scripts) | L9 | runtime |
| 20 | EC-197, EC-198, EC-202, EC-204, EC-209–212 | **Describer goldens for unused formers; WIDGETS; exact zoom; reasons; diff; irSchema; hash stability** | D1 is structural only; renders for ~20 formers have never run | describer |

---

## 4. Corpus-pending classes (placeholders)

Anticipated from the algebra alone, before the other slices' corpus output. Each is marked **corpus-pending**: confirm against the corpus and promote to EC/BV rows.

| ID | Area | Placeholder class | What the algebra predicts | Status |
|---|---|---|---|---|
| EC-C01 | cardio metrics | distance/time/pace targets | `length` and `time` exist and `speed` is named, but **pace (time/length) is not a named Dim**: TS `Div` gives never, the IR accepts {time:1,length:−1}, and UNITS has no pace unit, so it cannot be authored as a literal | corpus-pending |
| EC-C02 | cardio metrics | `timed` RepSpec as the only cardio work shape | no distance RepSpec. "5 km" needs a RepSpec extension or reuses load. Danger: a semantic overload of `loadKg` | corpus-pending |
| EC-C03 | cardio metrics | HR zones / RPE-only sessions | no `heartRate` input or dim; effort (RIR/RPE) is the only intensity sort, and RIR has no meaning for cardio | corpus-pending |
| EC-C04 | cardio metrics | `hitAll` on a timed set | floor/top semantics for seconds undefined | corpus-pending |
| EC-C05 | pain-gated regression | joint pain → regress load or ladder rung | `ev.feedback('jointPain', slot)` is ordinal and indexes a table. Regression = commit to `rung − 1` / `load × k`. Boundaries: level 0 vs 3; unrated = none must not count as pain-free | corpus-pending |
| EC-C06 | pain-gated regression | pre-session pain gate (skip or swap today) | requires a pre-session INPUT (`soreness` and `readiness` exist; `jointPain` is event-only). A plan reading `ev.feedback` is a `capabilityEscape`, so it needs a new input | corpus-pending |
| EC-C07 | pain-gated regression | swapExercise on pain | xform `swapExercise` exists, but no worked program exercises it (EC-116) | corpus-pending |
| EC-C08 | criteria phase gates | advance on a strength/bodyweight criterion | `advanceWhen` grants only `peer`: **an input-based gate (e1RM ≥ 1.5×BW) is a capabilityEscape**. Either widen HandoffCap or mirror the input into state | corpus-pending |
| EC-C09 | criteria phase gates | gate by N consecutive qualifying weeks | needs a streak in state (stab-ladder pattern); boundary at exactly N | corpus-pending |
| EC-C10 | criteria phase gates | gate never met within max | bounded max forces the advance (BV-75). The corpus may want "repeat phase" instead | corpus-pending |
| EC-C11 | density scoring | tonnage per time (EMOM / amrapFor) | `tonnage` is named, but **tonnage/time is not** (TS never, IR vector ok). Rounds completed in `amrapFor` has no EventQuery (`rounds` missing) | corpus-pending |
| EC-C12 | density scoring | density progression (same work, less time) | needs the session duration as an event fact; `ClosedFacts` has none | corpus-pending |
| EC-C13 | density scoring | EMOM with a non-fixed set count | checker refusal promised, not implemented (EC-221) | corpus-pending |
