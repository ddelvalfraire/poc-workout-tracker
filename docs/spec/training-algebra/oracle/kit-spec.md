# Training-program algebra: normative specification (v3 + R2)

This is the specification a second implementation is built against. It is rendered by `oracle/kit-verify.ts` from this template, the oracle's runtime mirrors and `rationale.md`; every table below marked *generated* cannot drift from the oracle. Where this text and a fixture disagree, the fixture is normative: it is the oracle's recorded behavior, and step 8 of `verify.sh` replays every fixture on every run.

Words: **MUST** and **MUST NOT** are requirements a conformance fixture checks. "The oracle" is the TypeScript package in `arena2/synthesis/`.

## 1. Sorts and values

### 1.1 Dimensions and units

A dimension is an integer exponent vector over the base dimensions `mass, rep, set, time, length, effort, week, day, angle, beat`, written as a JSON object with the nonzero exponents only (`{}` is dimensionless; `{"mass":1,"rep":-1}` is kg per rep). Two vectors are equal when every base exponent is equal (missing means 0).

A literal stores its **canonical** value `v` (kg, s, m, RIR, beats per second) beside the unit it displays in: `canonical = authored × scale` for a plain unit and `authored × scale(unit) ÷ scale(per)` for a rate. `rpe(n)` lowers to `v = 10 − n` in `rir` with `notation: "rpe"`. A rate per day or per week does not exist. Units (*generated* from `units.ts`; `prose(n)` is the display string of a number already converted to that unit):

{{UNITS}}

### 1.2 Sorts (`Ty`)

`q{dim, clock?}` a quantity, `clock ∈ {progress, calendar}` when it was read from a clock; `bool`; `ord{scale}` an ordinal level of a registered scale; `enum{name}` a built-in enum (`weekRole`, `setRole`, `hrZone`, `dietPhase`, `instanceStatus`, and the verdict `verdict` = `hit | missed | unknown`) or one the definition declares in `enums`; `ref{kind, logging?}` with `kind ∈ {exercise, slot, muscle, day}` and, for an exercise, the set of logging types it may have; `opt{of}`; `list{of, nonEmpty}`; `map{key, of}` keyed by a ref kind or `enum:NAME`; `dom{sort ∈ set|session|technique|tempo, metrics?, logging?}`; `upd{scope}` (a handler's patch; never appears in authored JSON).

A state field's **kind** is derived from its sort, looking through `opt` and `map`: a pure mass vector is `load`, a pure set vector is `volume`, anything else `plain`.

### 1.3 Runtime values (`Value`)

`{v:"q", n, dim, unit, per?, clock?, notation?}` with `n` canonical and `unit` the display unit (or `null`); `{v:"bool", b}`; `{v:"ord", scale, level}`; `{v:"enum", name, tag}`; `{v:"ref", kind, id}`; `{v:"none", cause}`; `{v:"list", items}`; `{v:"map", entries:[[key, value]...]}` keyed by a ref id, enum tag or a number's string; `{v:"set", t: IssuedTarget}`; `{v:"session", s}`; `{v:"technique", t}`; `{v:"tempo", t:[ecc,pause,con,top]}`; `{v:"patch", fields}`.

**Absence is flattened.** An `opt` value that is present IS its value; there is no `some` wrapper at runtime. An absent value is `none` with its cause. The checker guarantees no arithmetic, comparison or sink consumes a `none` except through `known`, `orElse` and the field sink.

### 1.4 The IR

The IR is the elaborated term JSON. `ir-schema.json` (*generated* from the TS declarations; tsc refuses a schema that omits a former, a field, or gets a field's optionality wrong) is the complete grammar: `#/$defs/Term` ({{FORMER_COUNT}} formers), the declarations (`FnDef`, `SchemeDef`, `ProgramDef`, `MacroDef` and their parts), the registries' entry shapes (`MetricDecl`, `FactDecl`, `ReducerDecl`, `ExerciseDecl`, `Vocab`), the refusal taxonomy (`TypeError`, `IngestRefusal`) and every runtime shape a fixture carries.

The formers: {{FORMERS}}.

Definitions live in a **registry**: the publication log in order, plus the vocabulary. A definition's publication index is its `seq`; `app` resolves only a definition published before its caller, so the reference graph is a DAG by time. Exercises, metrics, facts and reducers are vocabulary data (`Vocab`), not grammar: the checker and describer take them as input, and an extension is one entry.

## 2. Typing

{{TYPING}}

### 2.1 Capabilities by position (*generated* from `checker.ts` `GRANTS`)

A term is accepted at a position only if every capability it reads is granted there; a binder variable carries `elem`, which no position grants and its binder discharges.

{{GRANTS}}

### 2.2 The refusal taxonomy (*generated* from `ir-schema.json`)

Compile-time refusals (`TypeError`): every one carries `path` (the IR JSON path of the offending node, from the definition's root) and `message` (informative, not normative), plus the fields below.

{{REFUSAL_CODES}}

Ingest refusals (`IngestRefusal`), returned instead of a transition; the engine never applies the event:

{{INGEST_CODES}}

## 3. Evaluation

`evaluate(term, ctx) → Trace` is pure and total. A trace is `{node, value, kids, def?, note?}`: the node evaluated, its value, the traces of the subterms evaluated in evaluation order, `def` on an `app` node (a named-definition boundary), and `note` for a decision the value alone does not show. Kids record only what was evaluated: lazy formers do not evaluate (or trace) the branch they skip.

The context: `params` (name → value), `vars` (binder name → value), `enums` (declared tags), `ports` (the world reads granted at this position), `seq` (the publication index of the definition whose body runs), `extraFns` (definitions being published), `frame` (resolution only), `display` (metric → display unit: the unit of the program's grid for that metric; plans, handlers and resolutions all carry it), `logs` (metrics the enclosing session's exercise logs), `logging` (that exercise's logging type), `record` (issue-time frame capture only).

**Arithmetic law (P4).** Every number is an IEEE-754 binary64. Upstream of the sink every operation is the single binary64 operation this section names, in the order written (`a.n × b.n`, `x ÷ s`, then `+ 1e-9`, and so on); an implementation MUST NOT reassociate, fuse (no FMA) or widen. The sink's quantization law is pinned separately (6.1).

**Numbers.** `cmpNum(a, b)` is 0 when `a = b` (equal infinities included); when either side is not finite it is the plain order; otherwise it treats `|a − b| ≤ 1e-9 × max(1, |a|, |b|)` as equal. This tolerance is not transitive (`a ≈ b` and `b ≈ c` do not give `a ≈ c`); every use compares two operands once, so evaluation stays a function of its inputs (L2). `floorQ(x) = floor(x + 1e-9)`; `stepDown(x, s) = floor(x ÷ s + 1e-9) × s` and `stepUp(x, s) = ceil(x ÷ s − 1e-9) × s` (in that operation order). Every comparison, threshold, `round` and floor below uses these, and allocate's cap is `floorQ(cap)` (a cap of `(0.1 + 0.2) × 10` sets is 3).

**Frames.** A read node is one of `param self peer program fact pos cal keys`. Its **closed key** is the canonical JSON (section 7) of the node with every `var` subnode replaced by `{"k":"val","v": <the variable's value>}` (looked up in `vars`, then `frame.vars`); a variable with no value stays as it is. When `ctx.frame` is present and a read node's closed key is a key of `frame.reads`, the stored value is returned without consulting a port. The same node under a different binding (a shadowing `let`, an iteration) has a different key. A variable missing from `vars` is looked up in `frame.vars`.

### 3.1 Per former

| former | value |
|---|---|
| `lit` | `q`: `{v:"q", n: v, dim: dim(unit) − dim(per), unit, per?, notation?}`; `bool`, `ord`, `enum`, `ref` as themselves. |
| `var` | the binding in `vars`, else `frame.vars`. |
| `let` | evaluate `value`, bind `name`, evaluate `body`. `label` is prose only. |
| `named` | the value of `e` (identity; a prose and budget boundary). |
| `if` | evaluate `c`; `a` if it is `true`, else `b`. Only the chosen branch is evaluated. |
| `match` | evaluate `on` (an enum or verdict value); evaluate `cases[tag]`. |
| `arith` | both operands quantities. `clock = a.clock ?? b.clock`. `+ − min max`: `n` from the two `n`s, `dim = a.dim` unless `a.dim` is dimensionless, then `b.dim` (the empty sum's zero takes its partner's dimension: `sum([]) + 5 kg` is 5 kg), unit and `per` from `a` if `a` has a unit, else from `b`. `*`: `n = a.n × b.n`, `dim = a.dim + b.dim`; if `b` is dimensionless and `a` has a unit, keep `a`'s unit and `per` (`a` likewise when `a` is dimensionless); otherwise the unit is `unitFor(dim, [a.unit, b.unit], n)`: the first preferred unit of that dimension, else for a time vector `min` when `|n| ≥ 60` and `s` otherwise, else the first registered unit of that dimension, else `null`. |
| `cmp` | quantities by `cmpNum`; ordinals by level; enums: `==` is tag equality and every other operator is `false`. |
| `logic` | left first; `and` stops on `false`, `or` stops on `true` (the right side is then not evaluated). |
| `not` | negation. |
| `round` | `s` = the step's `n`. If `s ≤ 0` (or not a number) the operand is returned unchanged with note ``step {s} is not positive: left unrounded``. Else `down`: `stepDown(a.n, s)`; `up`: `stepUp(a.n, s)`. `nearest`: the one quantization law (6.1, BV-25/BV-26), **ties down**: 101.25 on 2.5 is 100. Every other field of `a` kept. |
| `ratio` | `none(zeroDenominator)` when `cmpNum(b.n, 0) = 0`, else `{n: a.n / b.n, dim: {}, unit: "x", clock: a.clock ?? b.clock}`. There is no other division. |
| `some` | the operand's value (flattened). |
| `none` | `none(declaredNone)`. |
| `known` | evaluate `a`; if `none`, that same value (its cause preserved); else bind `as` and evaluate `body`. `then` is a typing flag only. |
| `orElse` | evaluate `a`; if `none`, evaluate and return `b`; else `a`. |
| `asReps` | `{n: a.n, dim: {rep:1}, unit: "rep"}`. |
| `list` | items in order. |
| `nth` | `i = floorQ(index)`; `hold` clamps into `[0, len−1]`; `cycle` takes `((i mod len) + len) mod len` (so −1 is the last). When the index moved, note ``index {i} held|cycled to {j}``. Over an empty list the value is `none(emptyPick)` with note ``the list is empty`` (typed absence, never an undefined value). No checked definition reaches it: `nth` needs a list typed non-empty, an enum with no tags is refused at its declaration (`literalDomain`, path `enums.NAME`), and activation refuses an empty list for a non-empty list parameter; through any consumer the `none` behaves as every `none` does (the sink makes it silent; a former that needs a value fails naming its cause). |
| `fold` | `acc = init`; for each item, bind `acc` and `x` and evaluate `step`. |
| `tabulate` | evaluate `keys`. If the `keys` node is literally a `range` former: a list of `body` values in index order. Otherwise a map from each key's id (ref id, enum tag, or the number's string) to its `body` value, in key order. |
| `at` | the map entry for the key's id, else `none(missingKey{key})`. |
| `keys` | `slots` / `muscles`: the program's declaration order (the `keys` port); `enum:NAME`: that enum's tags in declaration order. |
| `range` | `[0, 1, …, n−1]` as `{dim:{}, unit:"x"}` quantities. |
| `sum` | the body over each item; a non-empty sum takes the first term's fields with the total `n`; an empty sum is `{n:0, dim:{}, unit:null}`, a dimensionless zero that takes the dimension of whatever it is added to, subtracted from or compared by min/max with (`arith`). |
| `count` | the number of items whose `where` is `true`, `unit: "x"`. |
| `pick` | over the items whose `where` holds (all if `where` is null) and whose score is present, the one with the best score (`q` → `n`, `ord` → level); a strictly better score replaces, so **ties keep the earlier item**; none → `none(emptyPick)`. |
| `allocate` | NORMATIVE. `units = max(0, floorQ(n))`. Scores and caps are evaluated once per `among` element, before the first unit. Each cap is `floorQ(cap)`. Elements with the same id are ONE candidate (the first occurrence's score and cap). For each of `min(units, max)` units: the candidate is the first element (in `among` order) with the strictly highest score among those whose units so far are below their cap; if none, stop. The result is `into` with each entry raised by its units; a candidate missing from `into` is appended with its units (`unit: "set"`). Note: ``{placed} of {units} set(s) placed`` then, when they apply, ``{units − max} over the bound of {max}``, ``{dropped} could not be placed``, ``a fraction of {f} set dropped``, joined by `; `. |
| `table` | No rows (refused at check): `none(emptyPick)`. Positional when every row's `when` is null: `i = floorQ(key)`, `cycle` wraps as `nth` does, otherwise clamps (hold). Ordinal key: the row whose `when` equals the level. Enum key: the row whose `when` is the tag. Ref key: the row whose `when` is the id, else `otherwise`. Quantity key: the first row whose threshold `w` (a `q` literal) has `key ≤ w` (inclusive, `cmpNum`), else `otherwise`. |
| `app` | Look the definition up (`extraFns` first, then the registry). Its `seq` (or the registry size when unpublished) MUST be below `ctx.seq` when `ctx.seq` is set, else evaluation fails (L1). Arguments evaluate in the caller's context; the body evaluates in a fresh context: `params` = the arguments, no ports, no variables, the callee's own enums, `seq` = the callee's. The node's trace has the body as its last kid and `def` set. |
| `param` | `params[name]`. |
| `self`, `peer`, `program`, `pos`, `cal` | the corresponding port (see 3.3). |
| `fact` | the key (if any) is evaluated to its id; `port.fact(fact, key)`. |
| `performed` | the logged sets of the step that id names from here (port: in a repeat block, the current iteration's), read by `pick`: `count` = number of sets (`unit "x"`); `sum` = total (0 when none); `last`/`best`/`worst` = `none(notPerformed)` when nothing was logged, else the value, where best follows the metric's `better` direction, flipped for a load when `ctx.logging` is `assisted_bodyweight` (the one assisted rule the verdict, the event reads and resolution share). Unit: `display[metric]`, else the first unit of the metric's dimension. |
| `prescribed` | the first issued set of the step that id names from here: its metric's edge (`floor` = a range's min, `top` = its max, else the bound's value) **as a quantity of the metric's dimension, in `display[metric]` or else the first unit of that dimension** (an 80 kg floor × 105% is 84 kg, never 8400%); no such metric or an `open` bound → `none(notTargeted)`; a silent field → its cause; an open field → its planned edge at issue, `none(notPerformed{first dependency})` during resolution. No issued sets → `none(notPerformed)`. |
| `event`, `agg` | the port, with `trained.muscle`, `slotsFor.muscle` and `weekly.by.of` evaluated to ids first. |
| `set` | each target metric becomes a **field** (3.2); `rest`, `tempo`, `cluster` evaluated; `{v:"set", t:{role, metrics, restSec, tempo, cluster}}`. |
| `session` | the telescope (3.2). |
| `xform` | evaluate `s` (a session) and `arg`; apply the transformer (3.2) with `logs` = the metrics the session's exercise logs and, for a swap, `argLogs` = the metrics the new exercise logs (null when unknown). A `scaleSets` factor above 1 leaves the count as it is, with note ``a factor of {f} above 1 leaves the sets as they are: …``. |
| `technique` | `{kind, stages: [the set targets]}`. |
| `tempo` | `[ecc, pause, con, top]`. |
| `patch` | `{v:"patch", fields: {field: {value, mode}}}`, values evaluated in key order. |

### 3.2 Fields, sessions and transformers

**Fields.** A bound becomes an issued field. Each edge term is evaluated; a `none` edge makes the field `{k:"silent", cause}` (a range checks `min` first). Otherwise `{k:"fixed", v: IssuedBound}` with canonical numbers; `open` is `{b:"open"}`. A literal range whose min is above its max is refused at check (`literalDomain`, at the target's metric); an evaluated one is made silent `outOfDomain` by the sink (4.2). A bound is **open** (resolved live) when, outside resolution, it depends on a logged set: its terms contain a `performed` read, or a `prescribed` read of a step whose issued field is itself open. Then the field is `{k:"open", bound, frame, planned, dependsOn}`: the bound term, its frame, the asPrescribed value as `planned`, and the steps it depends on.

**The frame (binding-environment-correct).** `frame.vars` holds every variable the bound's terms use that is bound where the set is issued. `frame.reads` holds, under its closed key, every non-live read ANY evaluation of the terms can make. It is built by a walk that carries the binders in scope, each with its value when that value does not depend on a logged set (else marked live): (1) a subterm with no `performed` or `prescribed` read and no live variable evaluates identically at issue and at resolution, so it is evaluated now and every read it makes is recorded under its closed key; (2) otherwise its children are walked: `let` and `known` bind the evaluated value of a static source (else live; a `known` whose static source is absent stops, since its body never runs), an iteration (`fold`, `tabulate`, `sum`, `count`, `pick`, `allocate`) over a static list walks its body once per item with the binder bound to it (a fold's accumulator is live), and a static condition (`if`, `match`, `logic`, `orElse`) walks only the branch resolution will take, while a live condition walks every branch. Speculatively evaluated reads are recorded on the stamp like any other read. The one read the walk cannot capture is a `fact` whose key depends on a logged set; the checker refuses it in a live position (`capabilityEscape`, cap `fact`, at the key), so resolution never reaches for a port the live context lacks.

**The telescope.** Steps run in order; a step may read only steps before it. Within a session the `prescribed` port answers the latest step with the id issued so far (so inside a repeat block, the current iteration's), and `performed` answers its asPrescribed sets (`asPrescribedSet`: every fixed non-open bound at its floor, `completed: true`). A count `n` or `range` is evaluated to `max(0, floorQ(·))`, and an evaluated range whose min is above its max issues its max as both edges (a literal one is refused, `literalDomain` at `count`); the target is evaluated once and repeated for the count (a range issues `max` slots). `until` and `while` issue `max` set slots, each target evaluated with the slots before it visible to its own self-reads; `while` evaluates `go` before each set and `until` evaluates `stop` after each, and the first failing `go` (or first true `stop`) fixes `planned`; the step carries `live: {cond, frame}` for the logger. A `repeat` block issues its body `n` times; step keys are `id` outside blocks and `id@iteration` inside. The intensifier is evaluated last.

**Transformers.** Judged sets are roles `working, amrap, backoff, test` (not `warmup`, `recovery`).
- `scaleMetric(metric, f)`: every set's field for that metric times `f` (an open field wraps its edge terms in `× f` and scales `planned`); silent stays silent.
- `scaleSets(f)`: each count to `min(n, max(1, floorQ(n × f)))`, except 0 stays 0, so a count never grows past its issued targets (a literal `f > 1` is refused at check, `literalDomain` at `arg`; growth is `addSets`); a range scales both edges (max not below min); until/while scale `max` and cap `planned`. Sets beyond the new count are dropped. Repeated scaling rounds each time.
- `capEffort(c)`: on judged sets only, and not at all when the exercise does not log effort: no effort field becomes `exact c`; `open` becomes `atLeast c`; `atMost v` becomes `exact c` when `v < c` and the range `[c, v]` otherwise (a deload cap must actually ease the set); every other bound's numbers become `max(n, c)` (an open field wraps `max(term, c rir)`).
- `setTempo(t)`: every set's tempo. `reshape(set)`: on judged sets, the given set's metrics replace those metrics; when the exercise's logging is known and the shape names a metric it does not log, nothing changes. `stripIntensifier`: no intensifier. `swapExercise(ref)`: the exercise; when the new exercise's logging is known and it does not log every metric the session targets, nothing changes. (These two are the runtime twins of the checker's `metricNotLogged` and `loggingMismatch`.) `addSets(k)`: `floorQ(k)` more copies of the last set of the last step that has a judged set, its count raised by `k` (both edges of a range; `max` and `planned` of until/while); `k ≤ 0` changes nothing.

### 3.3 Ports: how an instance's world reaches a term

Every port is a pure function of the head and stamped inputs, and the fact and calendar ports record each read on the issued fact or transition (L12).

- **fact(fact, key)**: of several readings of one (fact, key) the latest observation answers: the largest `observedOn`, then the one listed last (a post-session reading supersedes the issue-time one; the same rule reads bodyweight for e1RM). No reading → `none(factUnknown{fact, key})`. A reading older than the fact's `maxAgeDays` (`today − observedOn > maxAgeDays`) → `none(factStale{fact, observedOn, maxAgeDays})`, never the last known value. The first read of each (fact, key) is recorded with its value.
- **cal(q)**, at the stamped `today`, all values carrying `clock: "calendar"`: `day` = days since the anchor (`unit d`); `earlierToday` = this instance's sessions already closed today; `gap(sel)` = `today − last` where `last` is the tracked last day for the selector's key when that day is on or before today, else the latest matching occurrence on or before today, `none(noPriorSession)` when there is none (a gap is never negative); `recent(sel, days, measure)` over occurrences with `0 ≤ today − day < days`: `count`, `sum` of the metric totals (`dim {}`, `unit null`), `max` (`none(noPriorSession)` when empty).
- **pos(field)**: `week` (block weeks closed since activation, 0-based, `unit wk`, progress clock), `trainWeek` (earlier block weeks whose role is not `deload` or `taper`, across cycles), `role` (the calendar role of the week; past the end of a `once` calendar it reads `train`), `slotSession` (sessions of this slot closed so far; 0 at program scope).
- **self / peer / program**: the head's state; an unset field is `none(stateUnset{field})`. `program` at slot scope reads a slot-keyed map at this slot's key (`none(missingKey)`) or a scalar as itself. `peer(slot, field, prevPhase)` reads the previous macro phase's terminal state.
- **agg** (aggregate positions): `slotsFor(muscle)` = the slots whose primary muscle it is; `weekly(metric, by)` = planned volume per week under the pre-state, of what WOULD BE ISSUED: each slot's session after the plan policies firing now, the phase transform, L10 and the sink (4.1). Per session, over each step's planned targets (its count, a range's floor, an until/while step's planned count), `sets` counts the judged ones plus 0.5 per intensifier stage; any other metric sums the judged targets' fixed (or planned) floors of that metric: a silent field and a target without the metric add nothing (absence is not 0), and when nothing contributes the result is the empty sum, a true 0. Multiplied by the slot's sessions per week under the rotation; `by muscle` weights each slot by its contribution (primary 1, secondary 0.5), `by tag` sums tagged slots. The value has the metric's dimension (`set` for `sets`) and its display unit.
- **event(q)** (handlers), against the issued fact merged with its resolutions and the logged sets: `verdict` (3.4); `metric` as `performed`; `e1rm` = Epley `w × (1 + reps/30)`, the best over the step's logged sets with reps above 0, on **effective load**, per logging type: `weight_reps` (and any type whose load is the lifted load): the logged load, and a set with no logged load is SKIPPED (an unlogged load is not 0); `weighted_bodyweight`: bodyweight + load, a missing load reading 0 (no added load); `assisted_bodyweight`: bodyweight − load, a missing load reading 0 (no assistance); `bodyweight_reps`: bodyweight. Bodyweight is the snapshot's latest reading, `none(factUnknown bodyweight)` when it is needed and absent; `none(notPerformed)` when no set qualifies; `prescribed` as above with live semantics; `stages` over the final logged set's intensifier stages; `trained(muscle)`; `week` (the progress week at the event); `groupScore`.

### 3.4 The verdict

**The boundary contract (F14).** A set the athlete did not complete is not a performed set: the boundary drops it before the engine sees the log (`boundaryLogged`), and `PerformedSet` has no completion flag. A session whose every set was dropped is empty (`emptySession`), the empty-finish law applied uniformly.

Three-valued, against the ISSUED bounds merged with resolutions. For each step judged (`working`: every step; else the named ones), for each expected set (`n`; a range's `min`; until/while: as many as were logged), skipping non-judged roles under `working`, for each metric of the target: `effort` is never judged (a dose instruction); a silent field and an `open` bound are not bars and are skipped; an open (unresolved) field or an unlogged set makes the verdict at best `unknown`. A logged value (or, for a metric measured by a fact such as heart rate, the session snapshot's fact) is judged: `exact` is a bar in the metric's better direction; `range` on a higher-is-better metric is its floor (or top under `bound: top`), on a lower-is-better metric a zone met inside it; `atLeast`, `atMost` as written; an assisted load flips the direction. Any violation → `missed`; else any unknown, or zero judged values → `unknown`; else `hit`.

## 4. Issuance, stepping and the calendar

### 4.1 Prescribe

`prescribe(rt, ledger, day, facts, today)` first reconciles: `reconcile` lists a `dayClosed` for every day after `reconciledThrough` and before `today` (today is still open), each ingested as its own ledger entry. Then `issueSession` on the reconciled head:

1. An abandoned instance refuses `instanceClosed`; a completed one, or a week past the end of a `once` calendar, refuses `programComplete`. The day MUST be a declared day (the shell's choice; never moved).
2. Grids: each declared grid term evaluated to its canonical number.
3. **The plan channel**, in the one application order the checker verifies (`policyOrder`): role sugar, then the allocation default, then the declared policies, in array order. For each policy with a plan, its `when` is evaluated in the program context; under hit policy `first`, policies after the first that fired are not evaluated. The fired list is stamped.
4. For each slot of the day's groups in order: evaluate the slot's plan; apply each fired policy's `Use` in order (`applyUse`: the named session→session definition called with its arguments and the session in the hole); then the macro phase transform; then **L10**: in a `deload`, `taper` or `test` week the intensifier is dropped; then the sink (4.2). The slot's **trace** explains the issued numbers: each transform's `app` trace has, as the kid of its session argument, the trace of the session it was given (the plan's trace first); when L10 or the sink changed anything, a last node with the same `node` holds the issued session as its value, that chain as its only kid, and a note listing what changed (``L10: a deload week drops the intensifier``; ``the sink: work[0].load {"b":"exact","v":101.3} → {"b":"exact","v":102.5}``).
5. The due verdict (4.4), the position, and the stamp (`programHash`, `stateSeq`, `issuedOn`, every fact and calendar read, hit policy, fired policies, phase transform, grids, display units).

`issueKey = instance:sessions:day:stateSeq` (the head's seq: two issues at one rotation position with different state are different facts and never share resolutions); `defaultDay` is the rotation's next unmet entry (`weekly`: `days[weekEntries mod len]`; `alternate`: `days[sessions mod len]`; `pattern`: the non-rest days, `[sessions mod count]`; `daily`: `days[floor(sessions / perDay) mod len]`).

### 4.2 Quantization, ties and the sink

- **The sink** turns each field into what is issued. A silent field stays silent. A fixed bound with any number below `−1e-9` or not finite becomes `silent(outOfDomain{field: metric, value})`; 0 is legal. A range whose min is above its max (`cmpNum`) becomes `silent(outOfDomain{value: min})`.
- **Grids.** `load` and `distance` quantize to the program's grid `g` for them; every metric of rep or set dimension (reps) quantizes to whole numbers (`g = 1`). No grid, no quantization.
- **Direction (a bound may tighten, never loosen).** `exact` goes to the NEAREST step by the one quantization law (6.1, BV-25/BV-26: ties DOWN, in a pinned integer formulation; 101.25 kg on a 2.5 kg grid is 100 kg, 3.75 reps is 4). A floor goes UP: `atLeast v` and a range's min by `stepUp` (101.2 kg → 102.5). A ceiling goes DOWN: `atMost v` and a range's max by `stepDown` (101.3 kg → 100). Then `max(0, ·)`. A range left with no grid point inside (min above max after this) is `silent(outOfDomain{value: the original min})`. So the sink never prescribes more than computed for a ceiling or an exact bound below a tie, and may prescribe more for a floor (that is the floor honoured, never a looser bound). An open field's `planned` is sunk the same way, and so is every resolution, against the grids stamped on the issued fact (plus the whole-number grids).
- **`round`** (a term) to nearest obeys the same law, and `down`/`up` are `stepDown`/`stepUp`, so an author who reproduces the sink's math gets the engine's number.
- Set counts floor with `floorQ` and are never negative; `scaleSets` never goes below 1 on a non-empty line.

### 4.3 Step

`step(rt, head, event)` is pure; `ingest` makes the ledger a set of causeKeys (a duplicate causeKey returns `already` and changes nothing; a refusal changes nothing); `replay` folds `ingest` over events in ingestion order and MUST reproduce the head byte for byte. Every applied transition records `seq`, `causeKey`, `emitted` causeKeys, `fired` handlers (per field: value, mode `commit|propose|keep|void`, `demotedBy`), every fact and calendar read, and the state before and after.

- **sessionClosed.** Nothing logged → `emptySession` (a non-event: nothing fires, no gap resets). Completed → `programComplete`. A slot with no logged set in this session is UNTRAINED: its `session` handler does not run and records `skipped: "untrained"` (keep), and it is not counted below (no slot session, not in the week's or cycle's slots, not in the occurrence's slots). Every other slot of the issued session runs its `session` handler, then the aggregate's, all against the SAME pre-state and the event's fact snapshot (L4, L12). **The outcome channel** then demotes: for each policy with an outcome, in order (under `first`, only the first whose `when` holds), its `when` read against the snapshot; for every committed or proposed field whose kind is in `kinds`: a `volume` decrease under `volumeKeep` becomes `keep` (the old value; per FIELD: a map field any entry of which decreases is kept whole); a commit that moved in the policy's direction becomes `propose`. Movement is per entry for a map, on the canonical number, and an increase or decrease is between two PRESENT numbers: unset → value, value → absent, and a map entry appearing or disappearing move neither way (they are still a change for `any`); every demoting policy index is appended to `demotedBy`. Then **land**: commits write state; each handler's proposed fields become one proposal `proposal:causeKey:scope` snapshotting the proposed values, the fields' current values and the proposing handler (`on`), superseding (and removing, `superseded:key` emitted) any pending proposal of that scope on one of those fields. Then the occurrence enters the calendar (per-metric `sum` and `max` totals), and the progress clock advances.
- **The progress clock (L11).** A session or an owner `skip` closes one rotation entry (a `skip`, `pause`, `resume` or `abandon` of a completed instance is refused `programComplete`, exactly as a session is: nothing moves the clock past blockEnd): per-slot session counts, total sessions, week entries, and the slots trained this week and this cycle. Under `slide` drift the block week closes when the week's entries reach the rotation's entries per week (`weekly`: its days; `alternate`: `perWeek`; `pattern`: non-rest days; `daily`: `perDay × 7`). Under `anchored` drift, with `k = day − anchor`, each day a `dayClosed` closes with `k ≥ 0` and `(k + 1) mod 7 = 0` (true modulus) closes block week `⌊k/7⌋` when the instance is active; a day before the anchor closes nothing (an instance activated before its anchor has a lead-in with no windows and no weeks). Closing a week emits `weekEnd` (`week:instance:w`), then, on the calendar's last week, `cycleEnd` (`cycle:instance:c`) for a cycling calendar or `blockEnd` (`block:instance`, status `completed`) for a once calendar, each in the same transition, each reading the state the previous left and passing through the outcome channel. A slot boundary handler whose slot had no session in the window records `skipped: "untrained"` and does not run; the aggregate's runs if any slot trained.
- **dayClosed.** Monotonic: a day at or before `reconciledThrough` closes nothing; a later day closes, in order, every day from `reconciledThrough + 1` through it (so a skipped day never orphans a window, and reconciliation never moves back). For each such day the calendar closes windows ending that day (adherence), opens windows starting the next day (expectations), applies lapse and the pause status, and under anchored drift closes a block week as above. Each new adherence row emits `period:…` and runs every `periodClosed` handler, which may only propose or keep (L13).
- **pause** records `{from, until}`; **resume** closes the open pause the day before its day. The status is `paused` while a pause covers the open day (`reconciledThrough + 1`): a pause from today takes effect at its event, a future one on its first day, a bounded one ends by itself, a resume ends it; a pause whose `until` is before its `from` (a resume on its first day) covers nothing and voids nothing. The head's status mirrors it. **abandon** sets status `abandoned` (everything except `proposalDecided` is then refused `instanceClosed`).
- **Day stamps.** Every day an event carries (a `dayClosed` day, a pause's days, a resume's or abandon's day, a session's `localDay`) MUST be a real date; otherwise the event is refused `notALocalDay{stamped}` (P3).
- **ownerEdit** commits literal values to fields whose `writableBy` lists `owner`; `null` clears an optional field (`none(ownerCleared)`); anything else refuses `notOwnerWritable`.
- **proposalDecided.** An unknown key is a recorded no-op. Rejected → mode `keep`. Accepted → `commit`, unless (checked in this order) some proposed field's current declaration lists neither the proposal's handler `on` nor `owner` → `void` and `unwritable:key` emitted (EC-146), or some proposed field has moved since (`sameValue` against the snapshot base) → `void` and `stale:key` emitted. The writer of record is the proposing handler.
- **rebind** to a scheme whose state declaration differs refuses `rebindNeedsMigration`; otherwise the binding changes.

### 4.4 Calendar facts (time.ts)

Expectations are issued when a window opens and never before activation; windows tumble from the anchor (`day`: 1, `week`: 7, `days n`: n). Adherence is written by the `dayClosed` that ends the window: the occurrences in it that match the selector, `missed = max(0, n − met)` (0 if void); a window touching a pause or opened while lapsed is void. A late session appends an amendment (never edits adherence) and never moves a tracked last day backwards. Lapse: an active instance becomes `lapsed` when the UNPAUSED days after its latest occurrence on or before the closed day (by `localDay`, never by ingestion order; or after activation) reach `lapseAfterDays`; the clock does not run while paused; the next session reactivates it.

**Live resolution.** `resolveLive(issued, logged, already)` walks every open field of every slot in step order. A field is ready when each step it depends on has a logged set (its own step: the sets before it). The step a read names is the step itself (an until/while self-read) or the latest step with that id declared BEFORE it, so inside a repeat block it is the current iteration's row, exactly as planning saw it. The field's digest is FNV-1a of the canonical JSON of its dependencies' logged sets; its key is `issueKey:slot:stepKey:index:metric@digest`. A cell whose LATEST row (by `seq`) has that key gets no row (idempotent); otherwise a row is appended with `seq` = 1 + the largest seq so far, which supersedes, including a revert to dependency values an older row saw (so a key may recur; rows are identified by seq). The current view is re-read after every row, so a field reading a field resolved in the same call sees its new value. `currentView` replaces each open field with its cell's latest row by `seq`, never by array position.

**Activation.** Every slot's state comes from its init, evaluated against the state of the previous pass for all slots at once, repeated until a pass changes nothing (at most one pass per slot, plus one), so a binding argument that reads a peer's initial state gives the same state whatever the slots' declaration order. A non-empty list parameter given an empty list is refused.

**Projection.** Before each projected session the projection reconciles to its nominal day, as prescribe does, and stops when that alone ended the weeks asked for (under anchored drift the calendar can close the last week). Every projected session, the projected ledger and each macro phase's handoff values carry `projected: true` and `assume` (the assumption's kind), L9 in the values, not only at the top level. `completedFraction` = met over expected across non-void windows, each window's met capped at expected; 1 when nothing was expected.

**The due verdict** (soft, immutable on the issued fact): over the caps (`atMost`, `minGap`, the latter's gap evaluated at prescribe and clamped to `ceiling`), `due` if none blocks today; else the first day within the horizon (the largest `ceiling` or `withinDays`) that none blocks, as `early{dueOn, rule}`; else `notBefore{day: today + horizon + 1, rule}`, a proven lower bound, never an invented date.

**Feasibility** (checker): pairwise, each `atLeast` against each cap whose selector contains it (`any` contains everything; otherwise only equal canonical selectors), over one cyclic hyper-period.

## 5. Silence

The absence causes (*generated*):

{{ABSENCES}}

Rules (typed absence: no former ever yields an undefined value; `nth` over an empty list and a table with no rows are `none(emptyPick)`): a `none` carries its cause unchanged through `known` (which does not run its body) and is replaced only by `orElse`; arithmetic, comparison, indices and counts never meet a `none` (the checker's `absenceUnhandled`); at the sink an absent edge makes the field silent with that cause; a transformer leaves a silent field silent; the verdict skips a silent field (no load could be computed, so the athlete chose one); a stale fact is absent; a `none` initial state is `stateUnset` with the field's noun.

## 6. Laws

The laws as the engine states them (*verbatim* from `engine.ts`):

{{LAWS_ENGINE}}

The laws section of the rationale (*verbatim*), including the two-clock law, the day-selection trust boundary and the index bases:

{{LAWS_RATIONALE}}

### 6.1 R2 law decisions (*verbatim* from `rationale.md`)

{{R2_DECISIONS}}

## 7. Canonical JSON, identity and order

No identity surface depends on a JavaScript artifact (P1, P2).

- **Canonical JSON** is JSON text with object keys sorted by UTF-16 code unit, keys whose value is undefined omitted, arrays in order, no whitespace. A number is written as ECMAScript `Number::toString` writes it: the shortest digits that round-trip, `e+21`-style exponents from 1e21 and below 1e-6, `-0` as `0`; a non-finite number is `null`. Strings are escaped as JSON escapes them. Frame read keys (3, closed keys), resolution digests and the program hash use it.
- **Hashing.** `stamp.programHash` is FNV-1a 32 of the canonical JSON of the program definition; the `@xxxxxxxx` suffix of a `Resolution.key` is FNV-1a 32 of the canonical JSON of the field's dependencies' logged sets (in `dependsOn` order). FNV-1a 32: offset `0x811c9dc5`, prime `0x01000193`, over the UTF-16 CODE UNITS of the text (a character outside the BMP contributes both surrogates), as 8 lowercase hex digits. Both are normative: conformance compares them (section 8). Content hashing of elaborated definitions with de Bruijn names (EC-212) is still open; it will replace the program hash's input, not this encoding.
- **Declaration order.** Every collection a definition declares is consumed in declaration order: `keys slots` and `keys muscles`, the boundary handlers of `weekEnd`/`cycleEnd`/`blockEnd`, pick and allocate ties (lists), map entries (arrays). A slot id, day name or state field (scheme or aggregate) spelled like an array index (`0`, `12`) is refused at its declaration (`literalDomain`, path `slots.ID`, `days.NAME`, `state.FIELD`, `aggregate.state.FIELD`), because a JSON object read by a JavaScript engine lists such keys first in numeric order.
- **LocalDay** is `YYYY-MM-DD` naming a real proleptic-Gregorian date; `2026-02-30` is refused, never normalized (`notALocalDay`).
- A fixture or definition file is JSON. Fixtures are written with keys in the order the oracle constructed them; that order carries no meaning. Numbers are IEEE-754 doubles printed shortest-round-trip.
- Runtime-only shapes have one encoding each: a set is `{"$set": [...]}` (unordered; compared as a multiset of canonical JSON texts), a map `{"$map": [[k, v], ...]}`, a non-finite number `{"$num": "Infinity" | "-Infinity" | "NaN"}`, a registry `{"$registry": "<id>"}` naming `fixtures/registries/<id>.json`, a function-valued argument `{"$fn": "<id>"}` whose calls are recorded in the fixture's `world[id]`.
- Two sharing forms are expanded before a fixture is validated or compared: `{"$def": "id@version"}` is the corpus definition in `fixtures/defs/`, and `{"$ref": "#i/ret/<path>"}` is the value at that path inside the stored output of fixture `i` of the same file (which may itself contain `$ref`s). A path segment escapes `~` as `~0` and `/` as `~1`, as a JSON Pointer does (RFC 6901): a proposal key such as `proposal:week:prog/rp-upper-meso:0:program` is one segment.

## 8. Conformance protocol

1. Load `fixtures/defs/*.json` (one definition each) and `fixtures/registries/*.json` (`entries` in publication order, `vocab` `"base"` or inline). A registry is built by publishing the entries in order.
2. For each fixture (`fixtures/eval`, `fixtures/prose`: a file holds `{source, fixtures: [...]}`; `fixtures/refusals`: one fixture per file), decode `args` (positional, per the operation table below), replacing each `$fn` with a stub that answers each recorded call: a call is matched by its encoded arguments; repeated identical calls replay in order, then the last answer. A call that was never recorded is a **conformance failure**: the implementation read something the oracle did not (L12: reads are part of the stamped record).
3. Run the operation. If the fixture expects `{"throws": message}` the implementation MUST fail (any error; the message is the oracle's). Otherwise encode the result canonically and compare with `expected.ret` structurally: object keys as sets, arrays in order, `$set`s as multisets, numbers equal within `1e-9` relative. Arguments the oracle mutated are compared after the call against `expected.mutated[index]`.
4. Exempt from comparison (conformance mode): any `message` field (refusal and error text is informative). Digests (`programHash`, a resolution key's suffix) are compared: they are pinned (section 7). The oracle's own replay compares messages too (strict mode).
5. **Prose** fixtures compare the returned string or string list **exactly**. Locale assumptions (every prose fixture is tagged `en-GB (oracle)`): English words and plural rule `n = 1`; decimal point `.`, at most three decimals with trailing zeros dropped (`String(Number(n.toFixed(3)))`); no thousands separators; durations of a minute or more and paces as `m:ss`; dates as `Weekday D Month` (`Monday 12 October`), never with a year; ranges with an en dash (`8–12 reps`); every other character (curly quotes, `×`, `≥`) exactly as stored.
6. **Refusals** carry `expectedCode` and `expectedPath` (the first error). Compare the whole returned error list (codes, paths and fields, messages exempt). A refusal tagged `inputSchemaErrors` is authoring JSON that does not parse as IR; an implementation that parses strictly MAY reject it at parse, but MUST NOT accept it.
7. Operations name oracle entry points, some of them internal (`checker.top` is the term judgment over a raw `Scope`; the `describe-run.*` helpers are the issued-fact describers). An implementation supplies one adapter per operation it implements; the fixture counts per operation say how much each one carries.

### 8.1 Operations (*generated*; argument sorts are `ir-schema.json` `$defs`)

{{OPS}}

## 9. Constants

`BUDGET = {{BUDGET}}` operator nodes between name boundaries; `cal.recent` windows are literal, 1 to {{MAX_WINDOW_DAYS}} days; a frequency period is at most {{MAX_PERIOD_DAYS}} days; the default lapse is 21 days; numeric tolerance `1e-9` (relative for comparison, absolute for floors).
