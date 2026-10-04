# Training-program algebra: normative specification (v3 + R2)

This is the specification a second implementation is built against. It is rendered by `oracle/kit-verify.ts` from this template, the oracle's runtime mirrors and `rationale.md`; every table below marked *generated* cannot drift from the oracle. Where this text and a fixture disagree, the fixture is normative: it is the oracle's recorded behavior, and step 8 of `verify.sh` replays every fixture on every run.

Words: **MUST** and **MUST NOT** are requirements a conformance fixture checks. "The oracle" is the TypeScript package in `arena2/synthesis/`.

## 1. Sorts and values

### 1.1 Dimensions and units

A dimension is an integer exponent vector over the base dimensions `mass, rep, set, time, length, effort, week, day, angle, beat`, written as a JSON object with the nonzero exponents only (`{}` is dimensionless; `{"mass":1,"rep":-1}` is kg per rep). Two vectors are equal when every base exponent is equal (missing means 0).

A literal stores its **canonical** value `v` (kg, s, m, RIR, beats per second) beside the unit it displays in: `canonical = authored × scale` for a plain unit and `authored × scale(unit) ÷ scale(per)` for a rate. `rpe(n)` lowers to `v = 10 − n` in `rir` with `notation: "rpe"`. A rate per day or per week does not exist. Units (*generated* from `units.ts`; `prose(n)` is the display string of a number already converted to that unit):

| unit | dimension | scale (canonical = n × scale) | prose(1) | prose(2.5) |
|---|---|---|---|---|
| `kg` | mass | 1 | 1 kg | 2.5 kg |
| `lb` | mass | 0.45359237 | 1 lb | 2.5 lb |
| `rep` | reps | 1 | 1 rep | 2.5 reps |
| `set` | sets | 1 | 1 set | 2.5 sets |
| `s` | time | 1 | 1 s | 2.5 s |
| `min` | time | 60 | 1 min | 2:30 min |
| `h` | time | 3600 | 1 hour | 2.5 hours |
| `m` | length | 1 | 1 m | 2.5 m |
| `km` | length | 1000 | 1 km | 2.5 km |
| `mi` | length | 1609.344 | 1 mile | 2.5 miles |
| `rir` | effort | 1 | 1 in reserve | 2.5 in reserve |
| `pct` | one | 0.01 | 1% | 2.5% |
| `x` | one | 1 | 1 | 2.5 |
| `wk` | weeks | 1 | 1 week | 2.5 weeks |
| `d` | days | 1 | 1 day | 2.5 days |
| `deg` | angle | 1 | 1° | 2.5° |
| `bpm` | heartRate | 0.016666666666666666 | 1 bpm | 2.5 bpm |
| `minPerKm` | pace | 0.06 | 1:00 per km | 2:30 per km |
| `minPerMi` | pace | 0.03728227153424004 | 1:00 per mile | 2:30 per mile |
| `mps` | speed | 1 | 1 m/s | 2.5 m/s |
| `W` | power | 1 | 1 W | 2.5 W |
| `kcal` | energy | 4184 | 1 kcal | 2.5 kcal |
| `mmHg` | pressure | 133.322 | 1 mmHg | 2.5 mmHg |

### 1.2 Sorts (`Ty`)

`q{dim, clock?}` a quantity, `clock ∈ {progress, calendar}` when it was read from a clock; `bool`; `ord{scale}` an ordinal level of a registered scale; `enum{name}` a built-in enum (`weekRole`, `setRole`, `hrZone`, `dietPhase`, `instanceStatus`, and the verdict `verdict` = `hit | missed | unknown`) or one the definition declares in `enums`; `ref{kind, logging?}` with `kind ∈ {exercise, slot, muscle, day}` and, for an exercise, the set of logging types it may have; `opt{of}`; `list{of, nonEmpty}`; `map{key, of}` keyed by a ref kind or `enum:NAME`; `dom{sort ∈ set|session|technique|tempo, metrics?, logging?}`; `upd{scope}` (a handler's patch; never appears in authored JSON).

A state field's **kind** is derived from its sort, looking through `opt` and `map`: a pure mass vector is `load`, a pure set vector is `volume`, anything else `plain`.

### 1.3 Runtime values (`Value`)

`{v:"q", n, dim, unit, per?, clock?, notation?}` with `n` canonical and `unit` the display unit (or `null`); `{v:"bool", b}`; `{v:"ord", scale, level}`; `{v:"enum", name, tag}`; `{v:"ref", kind, id}`; `{v:"none", cause}`; `{v:"list", items}`; `{v:"map", entries:[[key, value]...]}` keyed by a ref id, enum tag or a number's string; `{v:"set", t: IssuedTarget}`; `{v:"session", s}`; `{v:"technique", t}`; `{v:"tempo", t:[ecc,pause,con,top]}`; `{v:"patch", fields}`.

**Absence is flattened.** An `opt` value that is present IS its value; there is no `some` wrapper at runtime. An absent value is `none` with its cause. The checker guarantees no arithmetic, comparison or sink consumes a `none` except through `known`, `orElse` and the field sink.

### 1.4 The IR

The IR is the elaborated term JSON. `ir-schema.json` (*generated* from the TS declarations; tsc refuses a schema that omits a former, a field, or gets a field's optionality wrong) is the complete grammar: `#/$defs/Term` (47 formers), the declarations (`FnDef`, `SchemeDef`, `ProgramDef`, `MacroDef` and their parts), the registries' entry shapes (`MetricDecl`, `FactDecl`, `ReducerDecl`, `ExerciseDecl`, `Vocab`), the refusal taxonomy (`TypeError`, `IngestRefusal`) and every runtime shape a fixture carries.

The formers: `lit`, `var`, `let`, `named`, `if`, `match`, `arith`, `cmp`, `logic`, `not`, `round`, `ratio`, `some`, `none`, `known`, `orElse`, `asReps`, `list`, `nth`, `fold`, `tabulate`, `at`, `keys`, `range`, `sum`, `count`, `pick`, `allocate`, `table`, `app`, `param`, `self`, `peer`, `program`, `fact`, `pos`, `cal`, `performed`, `prescribed`, `event`, `agg`, `set`, `session`, `xform`, `technique`, `tempo`, `patch`.

Definitions live in a **registry**: the publication log in order, plus the vocabulary. A definition's publication index is its `seq`; `app` resolves only a definition published before its caller, so the reference graph is a DAG by time. Exercises, metrics, facts and reducers are vocabulary data (`Vocab`), not grammar: the checker and describer take them as input, and an extension is one entry.

## 2. Typing

Sources: `checker.ts` (the term judgment), `checkdefs.ts` (definition-level rules). IR types: `algebra.ts` (`Term`, `Ty`, `Cap`), `engine.ts` (`TypeError`, `Position`, `BUDGET`). This section states what the code does. Where the code and its comments disagree, the code wins. The gaps an earlier reading of the code found are triaged under Observations, and the rules above already state the result.

### The judgment

`Σ; Δ; Γ ⊢ e : τ ! C`. Σ is the registry of definitions published before the current one. Δ is the `Scope`. Γ is `Scope.vars`. τ is a `Ty`. C is the set of capabilities `e` reads; a read is accepted iff its capability is in `GRANTS[Δ.position]`. The checker never computes C as a set: each context read checks its own capability on the spot (`need`).

`infer(term, scope, path, out) -> Res | null` with `Res = { ty: Ty, cost: number }`. It appends refusals to `out` and returns `null` when the node is refused. A parent whose child returned `null` normally stops without adding its own refusal (no cascade); exceptions are listed per former.

#### Scope fields

| Field | Type | Controls |
|---|---|---|
| `position` | `Position` | Which capabilities are granted (`GRANTS`). Also: `asReps` legality (`fnBody`), `session` count/target positions, `patch` result scope (`aggregate` gives `program`). |
| `def` | `{ id, seq }` | `id`: library test `isLib(id) = id.startsWith('lib/')` (for `asReps`, `named` cost). `seq`: publication index; `app` resolves only entries with `seq < def.seq`. An unpublished definition gets `seq = reg.seq.size` (after everything). |
| `params` | `Record<string, Ty>` | Sorts of `param` reads. |
| `state` | `Record<string, StateDecl> \| null` | Sorts of `self` reads; ownership for `patch`. `null` makes every `patch` a `capabilityEscape`. |
| `facts` | `string[]` | Declared facts. `fact` reads and a set metric's `measuredBy` must be listed. |
| `enums` | `Record<string, string[]>` | Enum tags for enum literals, `match`, `keys`, `table`. Built by `enumsWith(own)`: `ENUM_VALUES`, then `instanceStatus: [active, paused, lapsed, completed, abandoned]`, then the definition's own enums, then `verdict: [hit, missed, unknown]` last (a declaration cannot redefine `verdict`). |
| `peers` | `(slot, field, of) -> Ty \| undefined` or `null` | Sorts of `peer` reads. `null` makes every `peer` read `unknownName` (after the capability check). |
| `programFields` | `Record<string, Ty> \| null` | Sorts of `program` reads (the program's aggregate state field types). |
| `program` | `ProgramView \| null` | `{ slots, days, muscles, tags }`. When non-null, selectors, `slot`/`muscle`/`day` ref literals, `agg weekly` tags and muscle-keyed `table` rows are validated against it. When null they are not validated (a library definition is checked without a program). |
| `steps` | `{ earlier, all, own }` | `earlier`: step ids declared before the current step. `all`: every step id in scope, or `'any'` (aggregate scope: any step name accepted). `own`: the current `until`/`while` step's id, so its condition and target may read its own earlier sets; `null` otherwise. |
| `writer` | `Writer \| AggEventKind \| null` | The event a handler runs on. Non-null only in handler and aggregate handler scopes. `periodClosed` forbids `commit`. |
| `vars` | `Map<string, Ty>` | Γ. Extended by binders; lookups need no capability. |
| `reg` | `Registry` | `fns`, `schemes`, `programs`, `macros`, `seq`, `vocab` (`metrics`, `facts`, `exercises`). |

`baseScope(reg, position, params, def)` gives: `state: null, facts: [], enums: enumsWith(), peers: null, programFields: null, program: null, steps: { earlier: [], all: [], own: null }, writer: null, vars: empty`.

#### `top(term, scope, path, want, out) -> Res | null`

The entry point for every term that sits at a definition-level position.

1. `r = infer(term, scope, path, out)`. If `null`, return `null`.
2. If `want` is non-null, `r.ty` is `opt`, `want` is not, and `eqTy(r.ty.of, want)`: push `absenceUnhandled { got: r.ty }` at `path`, return `null` (the same answer `expect` gives).
3. If `want` is non-null and `!eqTy(r.ty, want)`: push `unitMismatch { expected: want, got: r.ty }` at `path`, return `null`.
4. If `want` is non-null and `calendarSink(r.ty, want)` fires: push `clockMix` at `path`, return `null`.
5. If `r.cost > BUDGET`: push `overBudget` at `path`. Still return `r`.

#### `eqTy(a, b)` ("a fits where b is wanted")

- `q`: `b.t === 'q'` and the dimension vectors are equal (`dimEq`: every base dimension's exponent equal, missing = 0). Clocks are ignored here; they are judged only at sinks.
- `bool`: `b.t === 'bool'`.
- `ord`: same `scale`.
- `enum`: same `name`.
- `ref`: same `kind`, and if both carry `logging`, every entry of `a.logging` is in `b.logging` (subset). Missing `logging` on either side passes.
- `opt`: `b.t === 'opt'` and `eqTy(a.of, b.of)`.
- `list`: `b.t === 'list'`, `eqTy(a.of, b.of)`, and `a.nonEmpty || !b.nonEmpty`: a non-empty list fits anywhere a list fits, and a possibly-empty one only where a possibly-empty one is wanted.
- `map`: same `key` string and `eqTy(a.of, b.of)`.
- `dom`: same `sort`. `metrics` and `logging` are ignored.
- `upd`: same `scope`.

#### `expect(r, want, at)` (internal, used inside `infer`)

1. `r` null: false, no refusal.
2. `r.ty` is `opt`, `want` is not, and `eqTy(r.ty.of, want)`: `absenceUnhandled { got: r.ty }` at `at`.
3. `!eqTy(r.ty, want)`: `unitMismatch { expected: want, got: r.ty }` at `at`.
4. `calendarSink(r.ty, want)`: `clockMix` at `at`.
5. Otherwise true.

#### Refusal objects and paths

Every refusal is `{ code, path, message, ...fields }` with the fields `engine.ts` `TypeError` lists per code. `message` is informative only. Fixtures compare the ordered list of `(code, path)`.

A path is the JSON path of the offending node from the definition root: a list of object keys (strings) and array indices (numbers). The definition-level caller supplies the root segment (for example `['body']`, `['plan']`, `['state', k, 'init']`). Each recursive `infer` call appends the IR field names it descends through, exactly as they appear in the JSON (`'a'`, `'b'`, `'c'`, `'value'`, `'body'`, `'cases', tag`, `'items', i`, `'args', name`, `'rows', i, 'then'`, `'q', 'of'`, `'target', metric, 'v'`, `'steps', i, 'body', j, 'count', 'n'`, ...). Refusals about the node itself use the node's path; refusals about a field use the node path plus that field. Exceptions where the reported path does not equal the descent path are called out per former.

Iteration over JSON objects (`cases`, `args`, `target`, `set`, `state`, `on`, `slots`, `days`, `grids`, `exports`, `imports`, `params`) follows JS own-property order: integer-like keys in ascending numeric order first, then the remaining keys in insertion order. A Rust implementation must preserve this (an insertion-ordered map with that one rule).

### Sorts

The checker has one sort language, `Ty` (an earlier `any` sort for the empty list literal was never produced and is gone).

| `Ty` form | Meaning |
|---|---|
| `{ t: 'q', dim: DimVec, clock?: 'progress' \| 'calendar' }` | A quantity. `dim` is an exponent vector over `mass rep set time length effort week day angle beat`. |
| `{ t: 'bool' }` | yes/no |
| `{ t: 'ord', scale }` | A rating on a registered scale (`SCALE_LEVELS[scale]` lists its levels). |
| `{ t: 'enum', name }` | An enum or the verdict (`name: 'verdict'`). |
| `{ t: 'ref', kind, logging? }` | `kind` in `exercise slot muscle day`. `logging` only on exercises. |
| `{ t: 'opt', of }` | Possibly absent. |
| `{ t: 'list', of, nonEmpty }` | |
| `{ t: 'map', key, of }` | `key` is a `RefKind` or `enum:<name>`. |
| `{ t: 'dom', sort, metrics?, logging? }` | `sort` in `set session technique tempo`. A set carries the metrics it names; a session its exercise's possible logging types and the metrics its steps target. |
| `{ t: 'upd', scope }` | A handler outcome, `scope` in `slot program`. |

Named constants: `ONE = q{}`, `SETS = q{set:1}`, `REPS = q{rep:1}`, `MASS = q{mass:1}`, `TIME = q{time:1}`, `DAYS = q{day:1}`, `EFFORT = q{effort:1}`, `WEEKS = q{week:1}`, `BOOL`, `VERDICT = enum verdict`. `dom(s) = { t: 'dom', sort: s }`, `ref(k) = { t: 'ref', kind: k }`.

Constructors:
- `opt(s)`: wraps (so `opt(opt x)` is possible).
- `list`, `map`: built inline by the formers below.
- `sessionTy(logging, metrics)`: `{ t: 'dom', sort: 'session', metrics }` plus `logging` only when defined.
- `keyTyOf(key)`: `enum:<n>` gives `enum n`; otherwise `ref(key)` (no logging).

`kindOf(ty)` (`structure.ts`): look through `opt` and `map` to the element; a `q` whose dim has exactly one base dimension `mass: 1` is `load`, exactly one `set: 1` is `volume`; everything else is `plain`. Used only by `noSuchKind`.

`isClause(s)`: `upd`; `dom` of any sort except `tempo`; `opt` of a clause. Clause-sorted results are budget boundaries (see The phrase budget).

`loggedMetrics(vocab, ls)`: the metric ids `m` (in vocab order) such that every logging type in `ls` is a key of `vocab.metrics[m].loggedBy`.

#### Clocks

Only reads produce clocks:

| Read | Sort |
|---|---|
| `pos` field `role` | `enum weekRole` |
| `pos` field `slotSession` | `q{}` progress |
| `pos` field `week` or `trainWeek` | `q{week:1}` progress |
| `event` `week` | `q{week:1}` progress |
| `cal` `day` | `q{day:1}` calendar |
| `cal` `earlierToday` | `q{}` calendar |
| `cal` `gap` | `opt q{day:1}` calendar |
| `cal` `recent` count | `q{}` calendar |
| `cal` `recent` sum | metric's dim, calendar |
| `cal` `recent` max | `opt` metric's dim, calendar |

Literals never carry a clock: `3 d` is `q{day:1}` with no clock, `2 wk` is `q{week:1}` with no clock. A `Ty` written inside a term (`none.of`, `list.of`) may carry a `clock` field and is taken as written: it only taints what it types. A declaration on the calendar clock is refused (rule 6).

`clockOf(s)`: the `clock` of a `q`, looking through `opt`; otherwise none.

Propagation and the four rules:

1. `clockRate`. A quantity literal with a `per` unit is refused if `unit` or `per` is in `CLOCK_UNITS = ['d', 'wk']`. Fields `{ unit, per }`, at the literal's path.
2. `joinClock` (arith, ratio, cmp). If both operands have a clock and the clocks differ: `clockMix` at the node path, node refused. Otherwise the result clock is the left clock if any, else the right. A clocked operand meeting an unclocked one is accepted and the result keeps the clock.
3. `calendarSink(got, want)` (every `expect` and `top`): fires iff `clockOf(got) === 'calendar'` and `clockOf(want) !== 'calendar'`. Refusal `clockMix`.
4. `nth` index: an index of clock `calendar` is `clockMix` at `p/i`.
5. `orElse` with a plain fallback: the result is either side, so it takes `joinClock(a.of, b)` (a `clockMix` at `p` when they differ). `orElse(none days, cal.day)` is calendar days, and rule 3 then refuses it at any non-calendar sink.
6. Declarations: a fn param or result, a scheme param or state field, a program param or aggregate state field whose `Ty` has the calendar clock anywhere (looking through `opt`, `list`, `map`) is `clockMix` at its declaration path (`['params', name]`, `['result']`, `['state', k, 'ty']`, `['aggregate', 'state', k, 'ty']`). Declaring the calendar clock would store or pass on a calendar value, so the declaration itself is refused.

What a calendar-derived value may reach: an operand of `cmp`, `arith`, `ratio`, `round` (as `a`), `sum` body, `pick` score, a `table` key, `known` binding, `if` branch `a` (result then keeps the calendar clock), `orElse`, and any position whose wanted sort is itself calendar-clocked. What it may not reach: any `expect`/`top` sink whose wanted sort is not calendar-clocked. In practice: a definition result, a fn argument, a state init or patch value, a set bound, a set count, a rest/tempo/cluster field, a policy `when` (wants `BOOL`, so only through `cmp`), and a list index. The result of `cmp` is `BOOL`, which carries no clock, so comparison is how a calendar value is consumed.

Progress-clocked values are never refused at a sink (only calendar is). A `table` keyed by a progress-clocked quantity is positional.

### Capabilities

`need(cap)`: accepted iff `cap` is in `GRANTS[scope.position]`; otherwise `capabilityEscape { cap, position }` at the node path and the node is refused.

| Position | Grants |
|---|---|
| `fnBody` | `param` |
| `init` | `param fact` |
| `plan` | `param state peer program fact pos cal` |
| `live` | `param state peer program fact pos cal performed` |
| `handler` | `param state peer program fact pos cal event` |
| `aggregate` | `param state fact pos cal event agg` |
| `bind` | `param peer` |
| `handoff` | `peer cal fact` |
| `policy` | `param state fact pos cal` |
| `cadence` | `param state peer` |
| `example` | (none) |

`elem` is in no row. Binder variables (`let`, `known.as`, `fold.acc`/`fold.x`, `tabulate.as`, `sum.as`, `count.as`, `pick.as`, `allocate.as`) are entered into `vars` for the binder's body only, and a `var` read checks no capability. That is the whole of the "binder discharges `elem`" rule: a variable cannot be read outside its binder because it is not in `vars` there (`unknownName`).

Formers that call `need`: `param` (`param`), `self` (`state`), `peer` (`peer`), `program` (`program`), `fact` (`fact` or `event`), `pos` (`pos`), `cal` (`cal`), `performed`/`prescribed` (`performed`), `event` (`event`), `agg` (`agg`). `patch` does not call `need`; it checks `scope.state` and `scope.writer` directly and reports `capabilityEscape { cap: 'event' }`. The `cap` there is a stand-in for "not a handler scope": `GRANTS` is not consulted, and the value is fixed at `'event'` whatever the position grants.

### Per-former rules

Notation: `p` is the node path; `p/x/y` is `[...p, 'x', 'y']`. "Sub x" means infer field `x` at `p/x` with the same scope unless stated. Refusals are listed in the order they are checked; the first one that fires refuses the node unless marked "continues". Cost is the node's own operator count (see The phrase budget). Formers not listed under a capability read none.

#### Core

**lit** (cost 0)
- `q`: `unit` not a registered unit: `unknownName { name: unit }` at `p`; else `per` present and not registered: `unknownName { name: per }`. Then if `per` and (`unit` or `per` in `['d','wk']`): `clockRate { unit, per }` at `p`. Else `q` with `dim = litDim(unit, per)` (unit's dim, minus per's dim when present), no clock.
- `bool`: `BOOL`.
- `ord`: `ord scale` if `level` is in `SCALE_LEVELS[scale]`; else `unknownName { name: '<scale> <level>' }` at `p` (also for an unknown scale).
- `enum`: `enum name` if `scope.enums[name]` contains `tag`; else `unknownName { name: '<name>.<tag>' }`.
- `ref`: kind `slot`, `muscle` or `day`: when `scope.program` is non-null and its `slots`/`muscles`/`days` lack `id`, `unknownName { name: id }`; else `ref(kind)`. `exercise`: if `vocab.exercises[id]` exists, `{ ref exercise, logging: [x.logging] }`; else `unknownName { name: id }`.
- Any other literal kind: `unknownName { name: kind }` at `p`.

**var** (cost 0): `vars[name]`, else `unknownName { name }`.

**let** (cost 0)
1. `label` missing or empty: `unlabeledLet` at `p` (checked before anything is inferred).
2. Sub `value`; null refuses. The value is a budget boundary (overBudget check, reset).
3. Sub `body` with `name` bound to the value's sort. Result: body's sort.

**named** (cost 1 outside the library, 0 when `isLib(scope.def.id)`)
- Sub `e`; the child is a budget boundary. Result: `e`'s sort. `noun` is not checked.

**if** (cost 1)
1. Sub `c`, `a`, `b` (all three are inferred, so all three can report).
2. `expect(c, BOOL)` at `p/c`; then `a` must be non-null; then `expect(b, a.ty)` at `p/b`. Short-circuit in that order.
3. Result: if both are `dom` and `a.sort` is `set`: `dom set` with `metrics` = union (a's first, then b's new ones). If `session`: `sessionTy(logging, metrics)` with metrics the same union and `logging` the union of both only when both have it, else undefined. Otherwise `a.ty`.
- Asymmetry: `b` must fit `a`, so a calendar `a` with a plain `b` passes (result calendar) while a plain `a` with a calendar `b` is `clockMix` at `p/b`.

**match** (cost 1)
1. Sub `on`; null refuses.
2. `on` not `enum`: `notComparable { got }` at `p`.
3. `tags = enums[name] ?? []`. Any tag not a key of `cases`: `nonExhaustive { missing }` (in tag order) at `p`.
4. For each case in object order: key not a tag: `unknownName { name: tag }` at `p` (refuses; earlier cases already inferred). Sub `cases/tag`; budget boundary; null refuses. Every case after the first: `expect(r, firstTy)` at `p/cases/tag`.
5. Result: the first case's sort.

#### Quantity

**arith** (cost 1)
1. `op` not in `+ - * min max`: `unknownName { name: op }` at `p`, before any child is inferred.
2. Sub `a`, `b`; either null refuses.
3. `a` then `b`: an `opt` operand is `absenceUnhandled { got }` at `p/a` or `p/b`.
4. Either not `q`: `notComparable { got: first non-q }` at `p`.
5. `joinClock` (may refuse `clockMix` at `p`).
6. `*`: result `q` with `dim = a.dim + b.dim` (vector sum), the joined clock.
7. Otherwise `!eqTy(b, a)`: `unitMismatch { expected: a, got: b }` at `p/b`. Result `q{a.dim}` with the joined clock.

**cmp** (cost 1)
1. Sub `a`, `b`; either null refuses.
2. `opt` operand (a then b): `absenceUnhandled` at `p/a` / `p/b`.
3. `a` is `enum verdict`: `notComparable { got: a }` at `p`.
4. `joinClock` (`clockMix` at `p`).
5. Accepted iff (`a` is `q` and `eqTy(a,b)`) or (`a` is `ord` and `eqTy(a,b)`) or (`a` is `enum`, `eqTy(a,b)` and `op === '=='`). Otherwise `notComparable { got: b }` at `p`. `bool`, `ref`, lists and the rest are never comparable. Result `BOOL`.

**logic** (cost 1): sub `a`, `b`; `expect(a, BOOL)` at `p/a` then `expect(b, BOOL)` at `p/b` (short-circuit). Result `BOOL`.

**not** (cost 1): sub `a`; `expect(a, BOOL)` at `p/a`. Result `BOOL`.

**round** (cost 1)
1. Sub `a`, `step`.
2. `a` is `opt`: `absenceUnhandled { got: a }` at `p/a`. `a` null refuses; `a` not `q`: `unitMismatch { expected: ONE, got: a }` at `p`.
3. `step` is a quantity literal with `v <= 0` (or not a number): `literalDomain { former: 'round', field: 'step', value: v }` at `p/step`.
4. `expect(step, a.ty)` at `p/step`. Result `a.ty` (keeps `a`'s clock). `mode` is not checked.

**ratio** (cost 1)
1. Sub `a`, `b`; either null refuses.
2. `opt` operand (a then b): `absenceUnhandled { got }` at `p/a` / `p/b`.
3. `a` not `q`: `notComparable { got: a }` at `p`.
4. `joinClock` (`clockMix` at `p`).
5. `!eqTy(b, a)`: `unitMismatch { expected: a, got: b }` at `p/b`.
6. Result `opt q{}` with the joined clock.

#### Absence

**some** (cost 0): sub `a`; result `opt(a)`.

**none** (cost 0): result `opt(of)`. `of` is taken as written, unchecked.

**known** (cost 0)
1. Sub `a`; null refuses. `a` not `opt`: `unitMismatch { expected: opt a, got: a }` at `p`.
2. Sub `body` with `as` bound to `a.of`. Null refuses.
3. `then` true and body not `opt`: `unitMismatch { expected: opt body, got: body }` at `p`.
4. Result: `then` ? body : `opt(body)`.

**orElse** (cost 1)
1. Sub `a`, `b`; either null refuses.
2. `a` not `opt`: `unitMismatch { expected: opt a, got: a }` at `p`.
3. `eqTy(b, a.of)`: `joinClock(a.of, b)` (`clockMix` at `p` when the clocks differ); result `a.of` carrying the joined clock (Clocks, rule 5).
4. Else `expect(b, a.ty)` at `p/b`; result `a.ty` (an `opt` default keeps the result optional).

**asReps** (cost 0)
1. `position !== 'fnBody'` or `!isLib(def.id)`: `scopedFormer { former: 'asReps' }` at `p`, before `a` is inferred.
2. Sub `a`; `expect(a, EFFORT)` at `p/a`. Result `REPS`.

#### Finite collections

**list** (cost 0): sub each `items/i`; `expect(item, of)` at `p/items/i` (every item checked, continues). Result `{ list, of, nonEmpty: items.length > 0 }` regardless of item refusals.

**nth** (cost 1)
1. Sub `xs`, `i`; either null refuses.
2. `xs` not a `list` or not `nonEmpty`: `unitMismatch { expected: list1 ONE, got }` at `p`.
3. `i` not `q`, or dim neither `{}` nor `{week:1}`: `unitMismatch { expected: ONE, got }` at `p`.
4. `i` clock `calendar`: `clockMix` at `p/i`.
5. `i` is a quantity literal whose `v` is not an integer `>= 0`: `literalDomain { former: 'nth', field: 'i', value }` at `p/i`.
6. Result `xs.of`. `overflow` is not checked.

**fold** (cost 1)
1. Sub `xs`, `init`; either null refuses.
2. `xs` not `list`: `unitMismatch` at `p`.
3. `init` is `upd`: `nonGroundAccumulator { got: init }` at `p`.
4. Sub `step` with `acc: init.ty` and `x: xs.of` bound (if the names coincide, `x` wins). `expect(step, init.ty)` at `p/step`. Result `init.ty`.

**tabulate** (cost 1)
1. Sub `keys`; null refuses.
2. `keys` is a list of `q` with dim `{}` (any clock, any origin, not only `range`): sub `body` with `as: keys.of`; result `{ list, of: body, nonEmpty: keys.nonEmpty }`.
3. Else `keys` not a list, or element neither `ref` nor `enum`: `unitMismatch { expected: list ref slot, got }` at `p`.
4. Else sub `body` with `as: keys.of`; result `{ map, key: ref kind or 'enum:<name>', of: body }`.

**at** (cost 0)
1. Sub `m`, `key`; either null refuses.
2. `m` not `map`: `unitMismatch` at `p`.
3. `expect(key, keyTyOf(m.key))` at `p/key`. Result `opt(m.of)`.

**keys** (cost 0)
- `of` starts with `enum:`: name not in `enums`: `unknownName { name }` at `p`; else `{ list, of: enum name, nonEmpty: true }`.
- `of === 'slots'`: `{ list, of: ref slot, nonEmpty: false }`.
- `of === 'muscles'`: `{ list, of: ref muscle, nonEmpty: false }`.
- Any other string: `unknownName { name: of }` at `p`.

**range** (cost 0): `n` must be an integer `>= 1`, else `boundNotLiteral { got: n }` at `p/n`. Result `{ list, of: ONE, nonEmpty: true }`.

**sum**, **count** (cost 1)
1. Sub `xs`; null refuses. Not `list`: `unitMismatch` at `p`.
2. Sub `body` (sum) or `where` (count) with `as: xs.of`; null refuses.
3. count: `expect(where, BOOL)` at `p/where`; result `ONE`.
4. sum: body `q`: result body's sort (dim and clock). Otherwise `unitMismatch { expected: ONE, got }` at `p`.

**pick** (cost 1)
1. Sub `xs`; null refuses. Not `list`: `unitMismatch` at `p`.
2. If `where`: sub with `as: xs.of`, `expect(where, BOOL)` at `p/where` (continues).
3. Sub `score` with `as: xs.of`. If non-null and neither `q` nor `ord`: `notComparable { got }` at `p` (refuses).
4. Result `opt(xs.of)`, even when `where` was refused or `score` returned null.

**allocate** (cost 1)
1. `max` not an integer `>= 1`: `boundNotLiteral { got: max }` at `p/max` (continues).
2. `n` is a quantity literal, `max` is a number, and `n.v > max`: `nExceedsMax { n, max }` at `p/n`, refused before any child is inferred.
3. Sub `n`, `into`, `among`, then `score` and `cap` with `as: ref slot`.
4. Short-circuit chain: `expect(n, SETS)` at `p/n`, `expect(into, map slot SETS)` at `p/into`, `expect(among, list ref slot)` at `p/among`, `expect(score, ONE)` at `p/score`, `expect(cap, SETS)` at `p/cap`. Only the first failure is reported.
5. Result `map slot SETS`.

#### Tables

**table** (cost 1)
1. Sub `key`; null refuses.
2. Rows, in order: sub `rows/i/then`, budget boundary, then (after the first non-null row) `expect(r, firstTy)` at `p/rows/i/then`. All rows are inferred. Then `otherwise` the same way at `p/otherwise`.
3. Zero rows: `tableShape { why: 'a table needs at least one row' }` at `p` (reported before rows' children since it is checked first, then rows are inferred).
4. Any row refused, or no row produced a sort: refused.
5. Dispatch on the key's sort `kt`. All `tableShape` refusals are at `p`.
   - `q` with clock `progress`: any `when` non-null: `tableShape`; no `overflow`: `tableShape`; `otherwise` present: `tableShape`.
   - Else `overflow` present: `tableShape`.
   - `ord` or `enum`: `otherwise` present: `tableShape`. Any `when` not a number (ord) or not a string (enum): `tableShape`. Two rows with the same `when`: `tableShape` (the second could never apply). `all` = scale levels or enum tags. Members of `all` absent from the row keys: `nonExhaustive { missing }` (as strings) at `p`. Then the first row key not in `all`: `unknownName { name }` at `p`.
   - Other `q` (no clock or calendar): no `otherwise`: `tableShape`. For each row i in order, at `p/rows/i/when`: `when` not a quantity literal object: `boundNotLiteral { got }`; unregistered `unit` or `per`: `unknownName`; a clock unit in a rate: `clockRate { unit, per }` (as for a literal); `litDim(unit, per) != kt.dim`: `unitMismatch`; `v <= previous v` (first row compared with -infinity): `thresholdOrder { at: i }`. First failure refuses.
   - `ref`: no `otherwise`: `tableShape`; any `when` not a string: `tableShape`; kind `muscle` and `scope.program` non-null: first `when` not in `program.muscles`: `unknownName` at `p`; kind `exercise`: first `when` not in `vocab.exercises`: `unknownName` at `p`.
   - Anything else (`bool`, `opt`, `list`, `map`, `dom`, `upd`): `tableShape`.
6. Result: the first row's sort.

#### Reuse

**app** (cost 0; not a budget boundary: argument costs add to the caller's phrase, see budget)
1. `k = '<id>@<version>'`. Not in `reg.fns`, or no `seq`, or `seq >= scope.def.seq`: `futureRef { ref: def }` at `p`. Refuses. Self-application and any later or unpublished version land here.
2. For each callee param (callee order) absent from `args`: `missingArg { param }` at `p` (continues).
3. For each arg (object order): not a callee param: `unknownName { name }` at `p/args/a` (continues); else sub `args/a` and `expect(arg, f.params[a])` at `p/args/a` (continues).
4. Result `f.result`, even when step 2 or 3 reported.

#### Context reads

**param** (`param`, cost 0): `params[name]`, else `unknownName { name }`.

**self** (`state`, cost 0): `state[field].ty`, else `unknownName { name: field }` (also when `state` is null).

**peer** (`peer`, cost 0): `peers(slot, field, of)`, else `unknownName { name: '<slot>.<field>' }`.

**program** (`program`, cost 0): field absent: `unknownName`. Field is a `map` keyed by `slot`: result `opt(of)` (read at this slot's key). A `map` keyed otherwise: `unknownName`. Else the field's sort.

**fact** (cost 0; key cost counts)
1. `vocab.facts[fact]` absent: `unknownName { name: fact }` at `p` (before the capability check).
2. `need('event')` if the fact's `observed` is `duringSession` or `postSession`, else `need('fact')`.
3. `fact` not in `scope.facts`: `undeclaredFact { fact }` at `p`.
4. Fact key `none` with a `key` term given: `unitMismatch { expected: ONE, got: ONE }` at `p`.
4. (continued) The `expected` and `got` fields are both `ONE` placeholders: there is no key sort to report, and the code is what tells the author to drop the key. The key term is not inferred.
5. Keyed fact: want `enum hrZone` for key `zone`, else `ref(key)`. No `key`: `missingArg { param: 'key' }` at `p`. Else sub `key` and `expect(key, want)` at `p/key` (a refused key reports only its own refusals).
6. Result `opt(fact.ty)`.

**pos** (`pos`, cost 0): `field` not one of `week`, `trainWeek`, `role`, `slotSession`: `unknownName { name: field }` at `p`. Else see Clocks.

**cal** (`cal`, cost 0)
- `day`, `earlierToday`: see Clocks.
- `gap`: selector check at `p/q/of`; result `opt q{day} calendar`.
- `recent`:
  1. `days` not an integer `>= 1`: `boundNotLiteral { got }` at `p/q/days`.
  2. `days > MAX_WINDOW_DAYS (56)`: `windowTooLong { days }` at `p/q/days`.
  3. Selector check at `p/q/of`.
  4. `measure.m === 'count'`: `q{}` calendar. Else metric not in `vocab.metrics`: `unknownName`. `sum`: metric sort calendar; otherwise `opt` of it.
- Other `q`: `unknownName { name: q }`.
- Selector check (only when `scope.program` is non-null): `slot`, `day`, `tag` must be in the view; `muscle` checks each listed muscle and stops at the first miss. Miss: `unknownName { name }` at the given path. `any` always passes.

**performed**, **prescribed** (`performed`, cost 0)
1. Step visibility: accepted if `step` is in `steps.earlier` or equals `steps.own`. Else if `steps.all === 'any'` or contains `step`: `forwardStepRef { step }` at `p`. Else `unknownName { name: step }` at `p`.
2. `performed` with `pick === 'count'`: `ONE`.
3. Metric not in `vocab.metrics`: `unknownName`.
4. `performed`: `pick` `sum` gives the metric sort, any other pick gives `opt` of it. `prescribed`: `opt` of it. `edge` is not checked.

**event** (`event`, cost 0; `trained` key cost counts). Step check `stepOk(s)`: `steps.all === 'any'` or contains `s`, else `unknownName { name: s }` at `p`. No forward check (a handler sees every plan step).
- `verdict`: `steps === 'working'` or every step passes `stepOk` (stops at the first miss). Result `enum verdict`.
- `metric`, `prescribed`: `stepOk`; `metric` with `pick === 'count'` gives `ONE`; metric lookup (`unknownName`); `metric` gives `pickTy` (as `performed`), `prescribed` gives `opt`.
- `e1rm`: `stepOk`; `opt MASS`.
- `stages`: `stepOk`; `pick === 'count'` gives `ONE`, else `opt REPS`.
- `trained`: sub `q/muscle`, `expect(muscle, ref muscle)` at `p/q/muscle`; `BOOL`.
- `week`: `q{week} progress`.
- `groupScore`: `score === 'time'` gives `opt TIME`, else `opt ONE`.
- Other: `unknownName`.

**agg** (`agg`, cost 0; child costs count)
- `slotsFor`: sub `q/muscle`, `expect(ref muscle)` at `p/q/muscle`; result `list ref slot` (possibly empty).
- `weekly`: metric `sets` gives `SETS`; else registry lookup (`unknownName`). `by.k === 'tag'`: when `scope.program` is non-null and lacks the tag, `unknownName { name: tag }` at `p`; else the metric sort. Else sub `q/by/of`, `expect(ref by.k)` at `p/q/by/of`.

#### Domain

**set** (cost 0, clause)
1. For each `target` metric `m` (object order), at `p/target/m`:
   - not in `vocab.metrics`: `unknownName`, skip to next metric;
   - bound kind `b.b` not in the metric's `shapes`: `shapeNotAllowed { metric, shape }` (continues);
   - metric has `measuredBy` not in `scope.facts`: `undeclaredFact { fact }` (continues);
   - bound check against `q{metric dim}` (no clock): `exact`, `atMost`: `v` at `p/target/m/v`, an `opt` value is unwrapped first (allowed). `atLeast`: `v`, `opt` not allowed (`absenceUnhandled`). `range`: `min` then `max` (short-circuit; `max` not inferred if `min` fails), both may be `opt`. `open`: nothing.
2. `rest`: `expect(TIME)` at `p/rest`. `tempo`: `expect(dom tempo)` at `p/tempo`. `cluster`: `expect(per, REPS)` at `p/cluster/per`, then (only if that passed) `expect(intraRest, TIME)` at `p/cluster/intraRest`.
3. All of the above accumulate; any failure refuses. Result `dom set` with `metrics = keys(target)` (including `open` bounds). `role` is not checked.

**session** (cost 0, clause)
- Positions: count terms are checked at `countPos` (`plan` if the scope is `live`, else the scope's position); targets and loop conditions at `targetPos` (`live` if the scope is `plan`, else the scope's position).
- `all = stepIds(steps)`: each step's id; a `repeat` contributes its own id then its body ids.
1. `steps` empty: `literalDomain { former: 'session', field: 'steps', value: 0 }` at `p`, before anything is inferred.
2. Sub `exercise`, `expect(ref exercise)` at `p/exercise` (continues). `logging` = the exercise sort's `logging` if it is a `ref`; `logs = loggedMetrics(logging)` when known.
3. Steps in order. A `step` at `['steps', i]`; a `repeat` checks `n` (integer `>= 1`, else `boundNotLiteral` at `p/steps/i/n`, which does not refuse the session), then each body step at `['steps', i, 'body', j]`, then appends the repeat id to `earlier`.
4. Per step `s` at relative path `at`, with `steps = { earlier: copy, all, own: null }` and `own = { earlier: copy, all, own: s.id }`:
   - `count.k === 'n'`: sub `at/count/n` at `countPos` with `steps`; `expect(SETS)` same path.
   - `range`: `min` then `max` likewise, short-circuit.
   - `until`/`while`: `max` must be an integer `>= 1` (`boundNotLiteral` at `p/at/count/max`, does not refuse). Sub `at/count/stop` (until) or `at/count/go` (while) at `targetPos` with `own`; `expect(BOOL)` at that same path.
   - Target: sub `at/target` at `targetPos` with `own` for loops, `steps` otherwise; `expect(dom set)` at `p/at/target`.
   - If the target's sort is `dom`: each metric is added to the session's target set; when `logs` is known and does not contain it: `metricNotLogged { metric, logging: logging joined by ' or ' }` at `p/at/target/target/m` when the target is a literal `set` (the metric's own node), else at `p/at/target` (an `if`, `app` or `param` target has no metric node).
   - Append `s.id` to `earlier`.
5. `intensifier`: `expect(dom technique)` at `p/intensifier`, in the session's own scope.
6. Any failure refuses. Result `sessionTy(logging, targets)`.

**xform** (cost 0, clause)
1. Sub `s`; `expect(dom session)` at `p/s`. Let `st` be its sort and `logs` its logged metrics when `st.logging` is known.
2. `want` by `op`: `scaleMetric ONE`, `scaleSets ONE`, `capEffort EFFORT`, `setTempo dom tempo`, `reshape dom set`, `stripIntensifier` none, `swapExercise ref exercise`, `addSets SETS`. Any other `op`: `unknownName { name: op }` at `p`.
3. `scaleMetric` with `metric` missing or unregistered: `unknownName { name: metric ?? 'metric' }` at `p`.
4. Touched metric (`scaleMetric`: `metric`; `capEffort`: `effort`) known not logged: `metricNotLogged` at `p`.
5. No `want` (`stripIntensifier`): result `st`.
6. `arg` missing: `missingArg { param: 'arg' }` at `p`.
7. Sub `arg`, `expect(want)` at `p/arg`.
8. `reshape` with known logging: first metric of the arg set not logged: `metricNotLogged` at `p/arg`.
9. `swapExercise`: arg without `logging`: result `sessionTy(undefined, st.metrics)`. Else `lost` = `st.metrics` not logged by the new logging; non-empty: `loggingMismatch { from: st.logging joined or 'unknown', to, metrics: lost }` at `p/arg`. Else `sessionTy(to, st.metrics)`.
10. Otherwise result `st`.

**technique** (cost 0, clause): empty `stages`: `literalDomain { former: 'technique', field: 'stages', value: 0 }` at `p/stages`. Else each `stages/i` sub then `expect(dom set)` at `p/stages/i`, stopping at the first failure (later stages are not inferred). Result `dom technique`. `kind` not checked.

**tempo** (cost 0, not a clause): the first of `ecc`, `pause`, `con`, `top` that is not a finite number `>= 0`: `literalDomain { former: 'tempo', field, value }` at `p/field`. Else `dom tempo`.

#### Outcome

**patch** (cost 0, clause)
1. `scope.state` null or `scope.writer` null: `capabilityEscape { cap: 'event', position }` at `p`.
2. For each field `f` (object order), at `p/set/f`:
   - `mode === 'commit'` and `writer === 'periodClosed'`: `timeCommit`, skip to next field (no owner or type check).
   - Field not in `state`: `notOwner { field }`, skip.
   - `writer` not in the field's `writableBy`: `notWritableHere { field, writer, writableBy }` (continues to the value).
   - Sub `set/f/to`, `expect(state[f].ty)` at `p/set/f/to`.
3. Any failure refuses. Result `upd` with scope `program` if `position === 'aggregate'`, else `slot`.

**any other `k`**: `unknownName { name: k }` at `p`.

Formers that return a sort after a child refusal (`list`, `pick`, `app`, and the reported-not-refusing bounds of `allocate.max`, loop `max` and `repeat.n`) let their parents add refusals on top. The definition is refused either way; the extra refusals are part of the fixture's ordered list, so they are specified behavior, not a cascade to suppress.

### The phrase budget

`BUDGET = 4`. `OVER_BUDGET_FIX = 'name an intermediate quantity: wrap a subterm in named(noun, …) or bind it with a labeled let'`.

Each `infer` frame records every child it infers (`kids`, in call order, with each child's path). The node's result:

- Non-clause sort: `cost = own + Σ kid.cost` over all recorded children (children already reset count 0).
- Clause sort (`isClause`): every child is passed through `boundary`, and the node's cost is 0. Its own count is discarded.

`boundary(kid)`: if `kid.cost > BUDGET`, push `overBudget { cost, budget: 4, fix }` at the kid's path; then set the kid's cost to 0.

Own costs: 1 for `named` (outside `lib/`), `if`, `match`, `arith`, `cmp`, `logic`, `not`, `round`, `ratio`, `orElse`, `nth`, `fold`, `tabulate`, `sum`, `count`, `pick`, `allocate`, `table`. 0 for every other former.

Boundaries (children reset):
- `let`: the `value` child, right after it is inferred. The body's cost passes through.
- `named`: its `e` child.
- `match`: each case. The `on` child's cost passes through.
- `table`: each row's `then` and `otherwise`. The key's cost passes through.
- Clause-sorted results: `set`, `session`, `xform`, `technique`, `patch`, an `if` whose result is a set or session, `some` of a clause.
- Definition roots: each `top` call starts from zero and checks `r.cost > BUDGET` at its own path.

Not a boundary: `app`. Its own cost is 0 and the callee body is not counted (it is budgeted at its own definition), but the argument terms' costs add to the caller's phrase.

A refused node returns `null`, and `boundary` runs only inside a node that succeeds. An over-budget subterm inside a refused node is therefore never reported. At `top`, `overBudget` is reported only after the sort and clock checks pass.

Worked: `(a + b) * c > d` costs 3. `x > 3 and y < 2 and z == 1` costs 5, refused at the root path with `cost: 5`.

### Definition-level rules

#### Publication order

`publish(entries, vocab)` builds the registry from an ordered log. Each entry is a definition or `{ def }`. Key `id@version`. A key already present is skipped (first wins). `seq` = the number of keys registered before it. `seqOf(reg, ref)` = `seq`, or `reg.seq.size` if unpublished. `futureRef` is reported by `app` (term), `checkUse`, program slot bindings, program imports and macro phases when the referent's `seq >= ` the checker's `def.seq`.

#### `checkFn(f, reg) -> TypeError[]`

Scope: `baseScope(reg, position, params, defOf(f.ref))` with `enums = enumsWith(f.enums)`.

0. Calendar-clocked declarations (Clocks, rule 6): each param in object order, then the result.
1. If `f.ref.id` starts with `lib/`: `templateHoles`. Holes are every `{word}` in `f.says` (regex `\{(\w+)\}`). `extra` = holes that are not params; `missing` = params that are not holes. Either non-empty: `templateHoles { extra, missing }` at `['says']`.
2. `top(body)` at `fnBody` with `f.params`, path `['body']`, want `f.result`.
3. For each example `i`: each `args` entry `a` (object order): not a param: `unknownName { name: a }` at `['examples', i, 'args', a]` (not inferred); else `top` at `example` with no params, same path, want `f.params[a]`. Then `gives` at `['examples', i, 'gives']`, want `f.result`.
4. Only if `out` is empty: run each example in order (`runFnExample`). Each failure: `exampleFailed` at `['examples', i]`.

#### `checkScheme(d, reg, ctx) -> TypeError[]`

`ctx = { peers, programFields, program }`, all null when checked standalone. Scope: `baseScope` with `state: d.state`, `facts: d.facts`, `enums: enumsWith(d.enums)`, the ctx fields, `steps: { earlier: [], all: planStepIds(d.plan), own: null }`, and `writer` per call. `planStepIds` collects, deduplicated in first-seen order, the `stepIds` of every `session` node found by a depth-first walk of the plan (the walk visits every object value that has a string `k`).

0. Calendar-clocked declarations (Clocks, rule 6): each param, then each state field's `ty`.
1. Each state field `k` (object order): `top(init)` at `init`, path `['state', k, 'init']`, want the field's `ty`.
2. `top(plan)` at `plan`, path `['plan']`, want `dom session`.
3. Each handler `on[ev]` that is present: `ev` not a slot event (`session weekEnd cycleEnd blockEnd periodClosed`): `unknownName { name: ev }` at `['on', ev]`, handler not checked. Else `top` at `handler` with `writer = ev`, path `['on', ev]`, want `upd slot`.
4. If library: `templateHoles` at `['says']` (after the terms, unlike `checkFn`).
5. Only if `out` is empty: each example `runSchemeExample`; failure: `exampleFailed` at `['examples', i]`.

#### `writeSet(d) -> WriteEntry[]`

Not a check. For a scheme, every `patch` node in each handler `on[ev]` (depth-first) contributes `{ scope: 'slot', field, on: ev, mode }` per field. For a program, the same over `aggregate.on` with `scope: 'program'`.

#### `checkProgram(p, reg) -> { at, errors }[]`

Returns a report list: first `{ at: 'program <id>@<v>', errors: out }`, then one `{ at: 'scheme <id>@<v>', errors }` per distinct bound scheme, in the order the slots first reach it. Scheme error paths are relative to the scheme root.

Shared scope `scope(position, extra)`: `baseScope(reg, position, p.params, defOf(p.ref))` with `facts: p.facts`, `enums: enumsWith(p.enums)`, `program: view`, then `extra`. `view = { slots: keys(p.slots), days: keys(p.days), muscles: p.muscles, tags: distinct union of each slot's meta.tags }`. `peers(slot, field, of)` = the type of `field` in the state of the scheme bound at `slot` when `of === 'current'`; a `prevPhase` read resolves to nothing in a program (only a macro handoff has a previous phase). `agState = p.aggregate?.state ?? {}`; `programFields` = its field types.

Checks, in this order, all into `out`:

0. **Declarations**: calendar-clocked params, then aggregate state fields (Clocks, rule 6).
1. **Slots** (object order). For each slot:
   1. Scheme not in `reg.schemes` or `seq >= def.seq`: `futureRef { ref }` at `['slots', s, 'scheme']`; skip the rest of this slot (including 1.4 to 1.6).
   2. Each scheme param missing from `args`: `missingArg { param }` at `['slots', s, 'args']`.
   3. Each arg: not a scheme param: `unknownName` at `['slots', s, 'args', a]`; else `top` at `bind` with `peers`, same path, want the param's sort.
   4. Each `meta.muscles` key not in `p.muscles`: `unknownName` at `['slots', s, 'meta']`.
   5. Count of contributions equal to 1 is not exactly 1: `primaryMuscle { slot, primaries }` at `['slots', s, 'meta', 'muscles']`.
   6. First time this scheme key is seen: `checkScheme(scheme, reg, { peers, programFields, program: view })` appended to the report.
2. **Days and groups** (days in object order, groups by index `gi`, `at = ['days', day, gi]`).
   1. Each member slot not in `p.slots`: `unknownName` at `at`.
   2. Group time fields, `top` at `example`, want `q{time:1}`: superset `between` then `after`; circuit `restBetweenRounds`; emom `every`; amrapFor `cap`. Path `[...at, field]`.
   3. `single` groups stop here. For each member with a known scheme plan:
      - any `set` node in the plan whose `rest` is present and not null (an omitted `rest` is no rest): `restOwnedByGroup { slot }` at `[...at, 'slots']`;
      - emom group without `untilFail`, and any plan step (repeat bodies flattened) whose `count.k !== 'n'`: `emomNeedsFixedCount { slot }` at `[...at, 'slots']`.
3. **Rotation**: the rotation's day names (`pattern`: string entries only) not in `p.days`: `unknownName` at `['rotation']`, one per miss.
4. **Policies** (index `i`), scope `scope('policy', { state: agState })`:
   1. `top(when)` at `['policies', i, 'when']`, want `BOOL`.
   2. `plan` present: `checkUse` at `['policies', i, 'plan']` with the policy scope.
   3. Previous policy's origin ranks after this one in `['role', 'allocation', 'declared']`: `policyOrder { at: i }` at `['policies', i]`.
   4. Each `outcome.demote.kinds` entry not in `kinds`: `noSuchKind { kind }` at `['policies', i, 'outcome', 'demote', 'kinds']`. `kinds` = `kindOf` of every state field of every bound scheme and of `agState`.
5. **Role double encoding**: `transformed` = week-role tags tested in the `when` of each policy with origin `role` and a `plan`. For each slot (object order) and each distinct role its scheme's plan tests: if transformed, `roleDoubleEncoding { role, slot }` at `['slots', s]`. A role test is: a `cmp` with `pos.role` on either side (collects enum literal tags on either side); a `match` on `pos.role` (its case keys); a `table` keyed on `pos.role` (its string row keys).
6. **Grids**: each present `grids[m]`, `top` at `example`, path `['grids', m]`, want `q{mass:1}` if `m === 'load'` else `q{length:1}`.
7. **Frequency** (index `i`, `at = ['frequency', i]`):
   1. Selector: `infer(cal gap of f.of)` at `plan`, path `[...at, 'of']` (reports only selector `unknownName`).
   2. `atLeast` and `atMost`: `n` not an integer `>= 1`: `boundNotLiteral { got: n }` at `[...at, 'n']`.
   3. `atLeast` with `per.k === 'days'`: `per.n` must be an integer in 1..28 (`MAX_PERIOD_DAYS`), else `boundNotLiteral` at `[...at, 'per', 'n']`.
   4. `atMost`: `withinDays` likewise at `[...at, 'withinDays']`.
   5. `minGap`: `ceiling` likewise at `[...at, 'ceiling']`; `top(gap)` at `cadence` with `state: agState, peers`, path `[...at, 'gap']`, want `DAYS`.
8. **Feasibility**: `eff = effectiveFrequency(p.frequency, p.rotation)` (the declared list, or the rotation's default when empty). Skipped when any `atLeast`/`atMost` count is not a literal positive integer (already refused) or any `atLeast` per-days period has `n > 28`. An explicit such period is refused in 7.3; a period over 28 days can still come from a `pattern` rotation's default, and feasibility is then not judged (it is decided only over windows of at most `MAX_PERIOD_DAYS`). Otherwise `feasibility(eff, rotation.k === 'daily' ? perDay : 1)`; a result `{ a, b, why }` gives `infeasibleFrequency { a, b, why }` at `['frequency']`. At most one. `feasibility` scans `atLeast` entries `i` in order: `n > L × perDayMax` gives `(i, null)`; then each non-`atLeast` entry `j` whose selector is `any` or equal to `i`'s: `minGap` with worst gap `g > 0` and `n × g > L` gives `(i, j)`; `atMost` failing the exhaustive cyclic placement gives `(i, j)`. First hit wins.
9. **Aggregate** (if present), scope with `state: ag.state`, `steps: { earlier: [], all: 'any', own: null }`:
   1. Each state `init` at `init`, path `['aggregate', 'state', k, 'init']`, want its `ty`.
   2. Each present handler: `ev` not an aggregate event (`weekEnd session periodClosed`): `unknownName { name: ev }` at `['aggregate', 'on', ev]`, handler not checked. Else `top` at `aggregate` with `writer = ev`, same path, want `upd program`.
10. **Exports**: each `exports[name]`: the slot's field type missing or `!eqTy(type, e.ty)`: `importMismatch { param: name, why }` at `['exports', name]`.
11. **Imports**: each `imports[param]`: the exporter is in `reg.programs` but its `seq >= def.seq`: `futureRef { ref: imp.from }` at `['imports', param]`, next import. Else the first applicable `why`: no such param; param not `opt`; exporter program `imp.from` not in `reg.programs`; exporter has neither an export nor a `LIFECYCLE_EXPORTS` entry (`completedFraction q{}`, `missedTotal q{}`, `finalWeek q{week}`, `status enum instanceStatus`) named `imp.export`; `!eqTy(param.of, et) && !eqTy(param, et)`. Any: `importMismatch { param, why }` at `['imports', param]`.

Term-level refusals such as `undeclaredFact`, `windowTooLong`, `clockMix` and `capabilityEscape` reach the program report through these `top` calls (the program's `facts` is the declared list).

`checkUse(u, at, scope, out)` (policies and macro transforms):
1. `u.def` not in `reg.fns` or `seq >= scope.def.seq`: `futureRef` at `at`, stop.
2. `f.params[u.hole]` (or `ONE` when missing) not `dom session`, or `f.result` not `dom session`: `unitMismatch { expected: dom session, got: f.result }` at `at` (continues).
3. Each param other than `hole` missing from `args`: `missingArg` at `[...at, 'args']`.
4. Each arg: unknown or equal to `hole`: `unknownName` at `[...at, 'args', a]`; else `top` with the given scope, same path, want the param's sort.

#### `checkMacro(m, reg) -> TypeError[]`

1. `anchor.k === 'peakOn'` and `drift !== 'anchored'`: `anchoredRequired` at `['drift']`.
2. Each phase `i`:
   1. Program not in `reg.programs`: `unknownName` at `['phases', i, 'program']`; skip the phase. Program `seq >= def.seq`: `futureRef { ref }` at the same path; skip the phase.
   2. In this order, all at `['phases', i, 'length']`, each independent: `peakOn` anchor and length not `fixed`: `peakNeedsFixed { phase: label }`; `open` and not the last phase: `openNotLast { phase }`; `fixed` and the program's `calendar.repeat !== 'once'`: `fixedNeedsOnce { phase }`; `bounded` with `min > max`: `boundsInverted { min, max }`.
   3. Each program param missing from `args`: `missingArg` at `['phases', i, 'args']`.
   4. Each arg: not a program param: `unknownName { name: a }` at `['phases', i, 'args', a]` (not inferred). Else `top` at `handoff` (no params, `facts` = the phase program's facts, builtin enums), same path, want the param's sort. In this scope `peer(..., 'prevPhase')` resolves against the previous phase's program; `'current'` resolves to nothing. In phase 0 every peer read is `unknownName`.
   5. `bounded`: `top(advanceWhen)` in the gate scope (same, but only `'current'` resolves, against this phase's program), path `['phases', i, 'length', 'advanceWhen']`, want `BOOL`.
   6. `transform`: `checkUse` at `['phases', i, 'transform']` with `baseScope(reg, 'policy', {}, def)`.

### Error order

Fixtures compare the whole ordered list of `(code, path)`. The order is fixed by:

1. Definition-level order: the numbered steps above, objects in JS own-property order, arrays by index.
2. Within a term: depth-first, children in the order each former infers them. A parent's own refusal normally follows its children's. Refusals that precede children: `arith` bad op, `let` missing label, `asReps` scoping, `allocate` `nExceedsMax`, `session` empty steps, `fact` unknown name and capability, every `need` failure, `app` `futureRef` and `missingArg`, `set` per-metric name/shape/fact checks (before that metric's bound), `patch` per-field `timeCommit`/`notOwner`/`notWritableHere` (before that field's value), `table` zero rows (before row children).
3. Short-circuits that suppress later refusals: `if` (c, then b vs a), `logic`, `allocate` expect chain, `range` bounds (set and count), `cluster`, `technique` stages, `match` cases (stop at the first refused case or unknown tag), `table` key-sort checks (first failure), selector `muscle` lists, `verdict` step lists.
4. Formers that continue after a child refusal and still return a sort: `list`, `pick`, `app`, and `allocate`'s `max`, `session`'s loop `max` and `repeat` `n` (reported, not refusing). Their parents can add refusals on top.
5. `overBudget` from a boundary is pushed when the boundary runs: immediately for `let` values, `named`, `match` cases and `table` rows; after all children for clause-sorted nodes; last for `top`.
6. `exampleFailed` appears only when every other check of that definition produced nothing, and then once per failing example in index order.
7. `checkProgram` returns the program's own list first, then each scheme's list in first-binding order.

### Observations

The first reading of the oracle listed 31 observations. Each was checked against the source and triaged: **fixed** (the oracle was wrong; the rules above state the corrected behavior, and `hardening.test.ts` holds a test that failed before the fix), **specified** (the behavior is deliberate or harmless, and the rules above now say so), or **not a defect**. No fix changed a stored output of a fixture that existed before the fixes; every fix is pinned by new fixtures.

| # | Observation | Verdict | Where it is now |
|---|---|---|---|
| 1 | `orElse` with a plain fallback dropped the clock, so a calendar value laundered into a plain quantity | fixed | orElse step 3, Clocks rule 5; demo §3 negative "a calendar count laundered through orElse" |
| 2 | a declared `clock: 'calendar'` (param, result, state field) let a calendar value be stored or passed on | fixed | Clocks rule 6 |
| 3 | the `any` sort was never produced | not a defect (dead code, deleted) | Sorts |
| 4 | an unknown literal kind fell into `var` (`unknownName` with no name) | fixed | lit |
| 5 | an unknown `unit`/`per` threw | fixed | lit `q`, table thresholds |
| 6 | `slot`/`muscle`/`day` ref literals and exercise-keyed rows were never validated | fixed (against the program view when present, the vocabulary for exercises) | lit `ref`, table `ref` |
| 7 | a refused fact key added a spurious `missingArg` | fixed | fact step 5 |
| 8 | a key on an unkeyed fact reports `unitMismatch` with `ONE`/`ONE` | specified | fact step 4 |
| 9 | `pos.field` was not validated | fixed | pos |
| 10 | `keys` of any unknown collection typed as muscles | fixed | keys |
| 11 | ordinal rows mapped `null` to level 0; duplicate ordinal/enum rows were accepted | fixed | table |
| 12 | threshold rows skipped `clockRate` | fixed | table |
| 13 | `agg weekly by tag` did not validate the tag | fixed | agg |
| 14 | an `until`/`while` condition's sort refusal was reported at `.../count` | fixed (now `.../count/stop` or `.../count/go`) | session step 4 |
| 15 | `metricNotLogged` on a non-literal step target named a path that does not exist | fixed (the step target's path) | session step 4 |
| 16 | an unknown `xform` op was accepted | fixed | xform step 2 |
| 17 | `technique` accepted zero stages; `tempo` accepted negative numbers | fixed | technique, tempo |
| 18 | a non-literal `allocate.max`, loop `max` or `repeat.n` is reported but does not refuse the node | not a defect: the definition is refused, and continuing reports more | Error order item 4 |
| 19 | `pick`, `app`, `list` return a sort after a child refusal, so parents add refusals | specified | end of Per-former rules |
| 20 | `top`, `ratio` and `round` reported an `opt` where a plain value is wanted as `unitMismatch`/`notComparable` | fixed (`absenceUnhandled`, as `expect`, `arith` and `cmp`) | top, ratio, round |
| 21 | `app` is not a budget boundary for its arguments | specified | app, The phrase budget |
| 22 | `patch` outside a handler names `cap: 'event'` as a stand-in | specified | Capabilities |
| 23 | `restOwnedByGroup` counted an omitted `rest` as rest | fixed | checkProgram 2.3 |
| 24 | unknown example and handoff argument names were not refused | fixed | checkFn 3, checkMacro 2.4 |
| 25 | `templateHoles` comes before the body in `checkFn` and after the handlers in `checkScheme` | specified: each order is fixed and stated | checkFn 1, checkScheme 4 |
| 26 | imports and macro phases could name a program published later | fixed (`futureRef`) | Publication order, checkProgram 11, checkMacro 2.1 |
| 27 | frequency `n` was not validated | fixed | checkProgram 7.2 |
| 28 | feasibility is skipped for a period over 28 days | specified (only a pattern rotation's default can still produce one) | checkProgram 8 |
| 29 | handler event keys were not validated | fixed | checkScheme 3, checkProgram 9.2 |
| 30 | a program's `peers` ignored `of`, so `prevPhase` resolved like `current` | fixed | checkProgram scope |
| 31 | the `eqTy` list rule was inverted | fixed | eqTy |

### 2.1 Capabilities by position (*generated* from `checker.ts` `GRANTS`)

A term is accepted at a position only if every capability it reads is granted there; a binder variable carries `elem`, which no position grants and its binder discharges.

| position | granted capabilities |
|---|---|
| fnBody | param |
| init | param, fact |
| plan | param, state, peer, program, fact, pos, cal |
| live | param, state, peer, program, fact, pos, cal, performed |
| handler | param, state, peer, program, fact, pos, cal, event |
| aggregate | param, state, fact, pos, cal, event, agg |
| bind | param, peer |
| handoff | peer, cal, fact |
| policy | param, state, fact, pos, cal |
| cadence | param, state, peer |
| example | (none) |

### 2.2 The refusal taxonomy (*generated* from `ir-schema.json`)

Compile-time refusals (`TypeError`): every one carries `path` (the IR JSON path of the offending node, from the definition's root) and `message` (informative, not normative), plus the fields below.

| code | fields |
|---|---|
| `unitMismatch` | `expected`, `got` |
| `notComparable` | `got` |
| `absenceUnhandled` | `got` |
| `unknownName` | `name` |
| `missingArg` | `param` |
| `forwardStepRef` | `step` |
| `capabilityEscape` | `cap`, `position` |
| `notOwner` | `field` |
| `notWritableHere` | `field`, `writer`, `writableBy` |
| `undeclaredFact` | `fact` |
| `nonGroundAccumulator` | `got` |
| `nonExhaustive` | `missing` |
| `boundNotLiteral` | `got` |
| `templateHoles` | `extra`, `missing` |
| `exampleFailed` | — |
| `futureRef` | `ref` |
| `peakNeedsFixed` | `phase` |
| `overBudget` | `cost`, `budget`, `fix` |
| `metricNotLogged` | `metric`, `logging` |
| `shapeNotAllowed` | `metric`, `shape` |
| `scopedFormer` | `former` |
| `infeasibleFrequency` | `a`, `b`, `why` |
| `timeCommit` | — |
| `anchoredRequired` | — |
| `restOwnedByGroup` | `slot` |
| `windowTooLong` | `days` |
| `primaryMuscle` | `slot`, `primaries` |
| `boundsInverted` | `min`, `max` |
| `openNotLast` | `phase` |
| `fixedNeedsOnce` | `phase` |
| `emomNeedsFixedCount` | `slot` |
| `importMismatch` | `param`, `why` |
| `clockMix` | — |
| `clockRate` | `unit`, `per` |
| `loggingMismatch` | `from`, `to`, `metrics` |
| `nExceedsMax` | `n`, `max` |
| `unlabeledLet` | — |
| `thresholdOrder` | `at` |
| `tableShape` | `why` |
| `roleDoubleEncoding` | `role`, `slot` |
| `noSuchKind` | `kind` |
| `policyOrder` | `at` |
| `literalDomain` | `former`, `field`, `value` |

Ingest refusals (`IngestRefusal`), returned instead of a transition; the engine never applies the event:

| code | fields |
|---|---|
| `emptySession` | `workoutId` |
| `dayStampOutOfRange` | `stamped`, `utc` |
| `programComplete` | — |
| `floorNotConfirmed` | `floorDays` |
| `instanceClosed` | `status` |
| `notOwnerWritable` | `scope`, `field` |
| `rebindNeedsMigration` | `slot`, `fields` |

## 3. Evaluation

`evaluate(term, ctx) → Trace` is pure and total. A trace is `{node, value, kids, def?, note?}`: the node evaluated, its value, the traces of the subterms evaluated in evaluation order, `def` on an `app` node (a named-definition boundary), and `note` for a decision the value alone does not show. Kids record only what was evaluated: lazy formers do not evaluate (or trace) the branch they skip.

The context: `params` (name → value), `vars` (binder name → value), `enums` (declared tags), `ports` (the world reads granted at this position), `seq` (the publication index of the definition whose body runs), `extraFns` (definitions being published), `frame` (resolution only), `display` (metric → display unit), `logs` (metrics the enclosing session's exercise logs).

**Numbers.** `cmpNum(a, b)` treats `|a − b| ≤ 1e-9 × max(1, |a|, |b|)` as equal. `floorQ(x) = floor(x + 1e-9)`. Every comparison, threshold, `round` and floor below uses these.

**Frames.** When `ctx.frame` is present and the node is a read (`param self peer program fact pos cal`) whose JSON text is a key of `frame.reads`, the stored value is returned without consulting a port. A variable missing from `vars` is looked up in `frame.vars`.

### 3.1 Per former

| former | value |
|---|---|
| `lit` | `q`: `{v:"q", n: v, dim: dim(unit) − dim(per), unit, per?, notation?}`; `bool`, `ord`, `enum`, `ref` as themselves. |
| `var` | the binding in `vars`, else `frame.vars`. |
| `let` | evaluate `value`, bind `name`, evaluate `body`. `label` is prose only. |
| `named` | the value of `e` (identity; a prose and budget boundary). |
| `if` | evaluate `c`; `a` if it is `true`, else `b`. Only the chosen branch is evaluated. |
| `match` | evaluate `on` (an enum or verdict value); evaluate `cases[tag]`. |
| `arith` | both operands quantities. `clock = a.clock ?? b.clock`. `+ − min max`: `n` from the two `n`s, `dim = a.dim`, unit and `per` from `a` if `a` has a unit, else from `b`. `*`: `n = a.n × b.n`, `dim = a.dim + b.dim`; if `b` is dimensionless and `a` has a unit, keep `a`'s unit and `per` (`a` likewise when `a` is dimensionless); otherwise the unit is `unitFor(dim, [a.unit, b.unit], n)`: the first preferred unit of that dimension, else for a time vector `min` when `|n| ≥ 60` and `s` otherwise, else the first registered unit of that dimension, else `null`. |
| `cmp` | quantities by `cmpNum`; ordinals by level; enums: `==` is tag equality and every other operator is `false`. |
| `logic` | left first; `and` stops on `false`, `or` stops on `true` (the right side is then not evaluated). |
| `not` | negation. |
| `round` | `s` = the step's `n`. If `s ≤ 0` (or not a number) the operand is returned unchanged with note ``step {s} is not positive: left unrounded``. Else `k = a.n / s`; `down`: `floor(k + 1e-9)`; `up`: `ceil(k − 1e-9)`; `n = r × s`. `nearest`: the one quantization law (6.1, BV-25/BV-26), **ties down**: 101.25 on 2.5 is 100. Every other field of `a` kept. |
| `ratio` | `none(zeroDenominator)` when `cmpNum(b.n, 0) = 0`, else `{n: a.n / b.n, dim: {}, unit: "x", clock: a.clock ?? b.clock}`. There is no other division. |
| `some` | the operand's value (flattened). |
| `none` | `none(declaredNone)`. |
| `known` | evaluate `a`; if `none`, that same value (its cause preserved); else bind `as` and evaluate `body`. `then` is a typing flag only. |
| `orElse` | evaluate `a`; if `none`, evaluate and return `b`; else `a`. |
| `asReps` | `{n: a.n, dim: {rep:1}, unit: "rep"}`. |
| `list` | items in order. |
| `nth` | `i = floorQ(index)`; `hold` clamps into `[0, len−1]`; `cycle` takes `((i mod len) + len) mod len` (so −1 is the last). When the index moved, note ``index {i} held|cycled to {j}``. |
| `fold` | `acc = init`; for each item, bind `acc` and `x` and evaluate `step`. |
| `tabulate` | evaluate `keys`. If the `keys` node is literally a `range` former: a list of `body` values in index order. Otherwise a map from each key's id (ref id, enum tag, or the number's string) to its `body` value, in key order. |
| `at` | the map entry for the key's id, else `none(missingKey{key})`. |
| `keys` | `slots` / `muscles`: the program's declaration order (the `keys` port); `enum:NAME`: that enum's tags in declaration order. |
| `range` | `[0, 1, …, n−1]` as `{dim:{}, unit:"x"}` quantities. |
| `sum` | the body over each item; a non-empty sum takes the first term's fields with the total `n`; an empty sum is `{n:0, dim:{}, unit:null}`. |
| `count` | the number of items whose `where` is `true`, `unit: "x"`. |
| `pick` | over the items whose `where` holds (all if `where` is null), the one with the best score (`q` → `n`, `ord` → level); a strictly better score replaces, so **ties keep the earlier item**; none → `none(emptyPick)`. |
| `allocate` | NORMATIVE. `units = max(0, floorQ(n))`. Scores and caps are evaluated once per `among` element, before the first unit. For each of `min(units, max)` units: the candidate is the first element (in `among` order) with the strictly highest score among those whose units so far are below their cap; if none, stop. The result is `into` with each entry raised by its units; a candidate missing from `into` is appended with its units (`unit: "set"`). Note: ``{placed} of {units} set(s) placed`` then, when they apply, ``{units − max} over the bound of {max}``, ``{dropped} could not be placed``, ``a fraction of {f} set dropped``, joined by `; `. |
| `table` | Positional when every row's `when` is null: `i = floorQ(key)`, `cycle` wraps as `nth` does, otherwise clamps (hold). Ordinal key: the row whose `when` equals the level. Enum key: the row whose `when` is the tag. Ref key: the row whose `when` is the id, else `otherwise`. Quantity key: the first row whose threshold `w` (a `q` literal) has `key ≤ w` (inclusive, `cmpNum`), else `otherwise`. |
| `app` | Look the definition up (`extraFns` first, then the registry). Its `seq` (or the registry size when unpublished) MUST be below `ctx.seq` when `ctx.seq` is set, else evaluation fails (L1). Arguments evaluate in the caller's context; the body evaluates in a fresh context: `params` = the arguments, no ports, no variables, the callee's own enums, `seq` = the callee's. The node's trace has the body as its last kid and `def` set. |
| `param` | `params[name]`. |
| `self`, `peer`, `program`, `pos`, `cal` | the corresponding port (see 3.3). |
| `fact` | the key (if any) is evaluated to its id; `port.fact(fact, key)`. |
| `performed` | the logged sets of the latest step with that id (port), read by `pick`: `count` = number of sets (`unit "x"`); `sum` = total (0 when none); `last`/`best`/`worst` = `none(notPerformed)` when nothing was logged, else the value, where best follows the metric's `better` direction (flipped for an assisted load). Unit: `display[metric]`, else the first unit of the metric's dimension. |
| `prescribed` | the first issued set of the latest step with that id: its metric's edge (`floor` = a range's min, `top` = its max, else the bound's value); no such metric or an `open` bound → `none(notTargeted)`; a silent field → its cause; an open field → its planned edge at issue, `none(notPerformed{first dependency})` during resolution. No issued sets → `none(notPerformed)`. |
| `event`, `agg` | the port, with `trained.muscle`, `slotsFor.muscle` and `weekly.by.of` evaluated to ids first. |
| `set` | each target metric becomes a **field** (3.2); `rest`, `tempo`, `cluster` evaluated; `{v:"set", t:{role, metrics, restSec, tempo, cluster}}`. |
| `session` | the telescope (3.2). |
| `xform` | evaluate `s` (a session) and `arg`; apply the transformer (3.2) with `logs` = the metrics the session's exercise logs (null when unknown). |
| `technique` | `{kind, stages: [the set targets]}`. |
| `tempo` | `[ecc, pause, con, top]`. |
| `patch` | `{v:"patch", fields: {field: {value, mode}}}`, values evaluated in key order. |

### 3.2 Fields, sessions and transformers

**Fields.** A bound becomes an issued field. Each edge term is evaluated; a `none` edge makes the field `{k:"silent", cause}` (a range checks `min` first). Otherwise `{k:"fixed", v: IssuedBound}` with canonical numbers; `open` is `{b:"open"}`. A bound is **open** (resolved live) when, outside resolution, it depends on a logged set: its terms contain a `performed` read, or a `prescribed` read of a step whose issued field is itself open. Then the field is `{k:"open", bound, frame, planned, dependsOn}`: the bound term, a frame capturing every non-live read the terms make whose variables are bound now (keyed by the read node's JSON text) plus those variables, the asPrescribed value as `planned`, and the steps it depends on.

**The telescope.** Steps run in order; a step may read only steps before it. Within a session the `prescribed` port answers the latest issued step with the id, and `performed` answers its asPrescribed sets (`asPrescribedSet`: every fixed non-open bound at its floor, `completed: true`). A count `n` or `range` is evaluated to `max(0, floorQ(·))`; the target is evaluated once and repeated for the count (a range issues `max` slots). `until` and `while` issue `max` set slots, each target evaluated with the slots before it visible to its own self-reads; `while` evaluates `go` before each set and `until` evaluates `stop` after each, and the first failing `go` (or first true `stop`) fixes `planned`; the step carries `live: {cond, frame}` for the logger. A `repeat` block issues its body `n` times; step keys are `id` outside blocks and `id@iteration` inside. The intensifier is evaluated last.

**Transformers.** Judged sets are roles `working, amrap, backoff, test` (not `warmup`, `recovery`).
- `scaleMetric(metric, f)`: every set's field for that metric times `f` (an open field wraps its edge terms in `× f` and scales `planned`); silent stays silent.
- `scaleSets(f)`: each count to `max(1, floorQ(n × f))`, except 0 stays 0; a range scales both edges (max not below min); until/while scale `max` and cap `planned`. Sets beyond the new count are dropped. Repeated scaling rounds each time.
- `capEffort(c)`: on judged sets only, and not at all when the exercise does not log effort: no effort field becomes `exact c`; `open` becomes `atLeast c`; `atMost v` with `v < c` becomes `exact c`; every other bound's numbers become `max(n, c)` (an open field wraps `max(term, c rir)`).
- `setTempo(t)`: every set's tempo. `reshape(set)`: on judged sets, the given set's metrics replace those metrics. `stripIntensifier`: no intensifier. `swapExercise(ref)`: the exercise. `addSets(k)`: `floorQ(k)` more copies of the last set of the last step that has a judged set, its count raised by `k` (both edges of a range; `max` and `planned` of until/while); `k ≤ 0` changes nothing.

### 3.3 Ports: how an instance's world reaches a term

Every port is a pure function of the head and stamped inputs, and the fact and calendar ports record each read on the issued fact or transition (L12).

- **fact(fact, key)**: no reading → `none(factUnknown{fact, key})`. A reading older than the fact's `maxAgeDays` (`today − observedOn > maxAgeDays`) → `none(factStale{fact, observedOn, maxAgeDays})`, never the last known value. The first read of each (fact, key) is recorded with its value.
- **cal(q)**, at the stamped `today`, all values carrying `clock: "calendar"`: `day` = days since the anchor (`unit d`); `earlierToday` = this instance's sessions already closed today; `gap(sel)` = `today − last` where `last` is the tracked last day for the selector's key (else the latest matching occurrence on or before today), `none(noPriorSession)` when there is none; `recent(sel, days, measure)` over occurrences with `0 ≤ today − day < days`: `count`, `sum` of the metric totals (`dim {}`, `unit null`), `max` (`none(noPriorSession)` when empty).
- **pos(field)**: `week` (block weeks closed since activation, 0-based, `unit wk`, progress clock), `trainWeek` (earlier block weeks whose role is not `deload` or `taper`, across cycles), `role` (the calendar role of the week; past the end of a `once` calendar it reads `train`), `slotSession` (sessions of this slot closed so far; 0 at program scope).
- **self / peer / program**: the head's state; an unset field is `none(stateUnset{field})`. `program` at slot scope reads a slot-keyed map at this slot's key (`none(missingKey)`) or a scalar as itself. `peer(slot, field, prevPhase)` reads the previous macro phase's terminal state.
- **agg** (aggregate positions): `slotsFor(muscle)` = the slots whose primary muscle it is; `weekly(metric, by)` = planned volume per week under the pre-state: per session, `sets` counts judged sets over each step's planned count plus 0.5 per intensifier stage, any other metric sums the judged sets' fixed (or planned) floors; multiplied by the slot's sessions per week under the rotation; `by muscle` weights each slot by its contribution (primary 1, secondary 0.5), `by tag` sums tagged slots.
- **event(q)** (handlers), against the issued fact merged with its resolutions and the logged sets: `verdict` (3.4); `metric` as `performed`; `e1rm` = Epley `w × (1 + reps/30)` over the step's logged sets on **effective load** (`weighted_bodyweight`: bodyweight + load; `assisted_bodyweight`: bodyweight − load; `bodyweight_reps`: bodyweight; else load), bodyweight from the snapshot, `none(factUnknown bodyweight)` when it is needed and absent, `none(notPerformed)` when no set has reps; `prescribed` as above with live semantics; `stages` over the final logged set's intensifier stages; `trained(muscle)`; `week` (the progress week at the event); `groupScore`.

### 3.4 The verdict

Three-valued, against the ISSUED bounds merged with resolutions. For each step judged (`working`: every step; else the named ones), for each expected set (`n`; a range's `min`; until/while: as many as were logged), skipping non-judged roles under `working`, for each metric of the target: `effort` is never judged (a dose instruction); a silent field and an `open` bound are not bars and are skipped; an open (unresolved) field or an unlogged set makes the verdict at best `unknown`. A logged value (or, for a metric measured by a fact such as heart rate, the session snapshot's fact) is judged: `exact` is a bar in the metric's better direction; `range` on a higher-is-better metric is its floor (or top under `bound: top`), on a lower-is-better metric a zone met inside it; `atLeast`, `atMost` as written; an assisted load flips the direction. Any violation → `missed`; else any unknown, or zero judged values → `unknown`; else `hit`.

## 4. Issuance, stepping and the calendar

### 4.1 Prescribe

`prescribe(rt, ledger, day, facts, today)` first reconciles: `reconcile` lists a `dayClosed` for every day after `reconciledThrough` and before `today` (today is still open), each ingested as its own ledger entry. Then `issueSession` on the reconciled head:

1. An abandoned instance refuses `instanceClosed`; a completed one, or a week past the end of a `once` calendar, refuses `programComplete`. The day MUST be a declared day (the shell's choice; never moved).
2. Grids: each declared grid term evaluated to its canonical number.
3. **The plan channel**, in the one application order the checker verifies (`policyOrder`): role sugar, then the allocation default, then the declared policies, in array order. For each policy with a plan, its `when` is evaluated in the program context; under hit policy `first`, policies after the first that fired are not evaluated. The fired list is stamped.
4. For each slot of the day's groups in order: evaluate the slot's plan; apply each fired policy's `Use` in order (`applyUse`: the named session→session definition called with its arguments and the session in the hole); then the macro phase transform; then **L10**: in a `deload`, `taper` or `test` week the intensifier is dropped; then the sink (4.2).
5. The due verdict (4.4), the position, and the stamp (`programHash`, `stateSeq`, `issuedOn`, every fact and calendar read, hit policy, fired policies, phase transform, grids, display units).

`issueKey = instance:sessions:day`; `defaultDay` is the rotation's next unmet entry (`weekly`: `days[weekEntries mod len]`; `alternate`: `days[sessions mod len]`; `pattern`: the non-rest days, `[sessions mod count]`; `daily`: `days[floor(sessions / perDay) mod len]`).

### 4.2 Quantization, ties and the sink

- **The sink** turns each field into what is issued. A silent field stays silent. A fixed bound with any number below `−1e-9` or not finite becomes `silent(outOfDomain{field: metric, value})`; 0 is legal. `load` and `distance` quantize to their grid `g` by the one quantization law (6.1, BV-25/BV-26: the **nearest step, ties DOWN**, in a pinned integer formulation; 101.25 kg on a 2.5 kg grid is 100 kg), then `max(0, ·)`. No grid, no quantization. An open field's `planned` is sunk the same way, and so is every resolution, against the grids stamped on the issued fact.
- **`round`** (a term) to nearest obeys the same law, so an author who reproduces the sink's math gets the engine's number.
- Set counts floor with `floorQ` and are never negative; `scaleSets` never goes below 1 on a non-empty line.

### 4.3 Step

`step(rt, head, event)` is pure; `ingest` makes the ledger a set of causeKeys (a duplicate causeKey returns `already` and changes nothing; a refusal changes nothing); `replay` folds `ingest` over events in ingestion order and MUST reproduce the head byte for byte. Every applied transition records `seq`, `causeKey`, `emitted` causeKeys, `fired` handlers (per field: value, mode `commit|propose|keep|void`, `demotedBy`), every fact and calendar read, and the state before and after.

- **sessionClosed.** Nothing logged → `emptySession` (a non-event: nothing fires, no gap resets). Completed → `programComplete`. Every slot of the issued session runs its `session` handler, then the aggregate's, all against the SAME pre-state and the event's fact snapshot (L4, L12). **The outcome channel** then demotes: for each policy with an outcome, in order (under `first`, only the first whose `when` holds), its `when` read against the snapshot; for every committed or proposed field whose kind is in `kinds`: a `volume` decrease under `volumeKeep` becomes `keep` (the old value); a commit that moved in the policy's direction (`decrease`, `increase` or `any`, per entry for a map, on the canonical number) becomes `propose`; every demoting policy index is appended to `demotedBy`. Then **land**: commits write state; each handler's proposed fields become one proposal `proposal:causeKey:scope` snapshotting the proposed values, the fields' current values and the proposing handler (`on`), superseding (and removing, `superseded:key` emitted) any pending proposal of that scope on one of those fields. Then the occurrence enters the calendar (per-metric `sum` and `max` totals), and the progress clock advances.
- **The progress clock (L11).** A session or an owner `skip` closes one rotation entry: per-slot session counts, total sessions, week entries, and the slots trained this week and this cycle. Under `slide` drift the block week closes when the week's entries reach the rotation's entries per week (`weekly`: its days; `alternate`: `perWeek`; `pattern`: non-rest days; `daily`: `perDay × 7`). Under `anchored` drift a `dayClosed` closes it when `(day − anchor + 1) mod 7 = 0` and the instance is active. Closing a week emits `weekEnd` (`week:instance:w`), then, on the calendar's last week, `cycleEnd` (`cycle:instance:c`) for a cycling calendar or `blockEnd` (`block:instance`, status `completed`) for a once calendar, each in the same transition, each reading the state the previous left and passing through the outcome channel. A slot boundary handler whose slot had no session in the window records `skipped: "untrained"` and does not run; the aggregate's runs if any slot trained.
- **dayClosed.** The calendar closes windows ending that day (adherence), opens windows starting the next day (expectations), and applies lapse. Each new adherence row emits `period:…` and runs every `periodClosed` handler, which may only propose or keep (L13).
- **pause** records `{from, until}`; **resume** closes the open pause the day before; **abandon** sets status `abandoned` (everything except `proposalDecided` is then refused `instanceClosed`).
- **ownerEdit** commits literal values to fields whose `writableBy` lists `owner`; `null` clears an optional field (`none(ownerCleared)`); anything else refuses `notOwnerWritable`.
- **proposalDecided.** An unknown key is a recorded no-op. Rejected → mode `keep`. Accepted → `commit`, unless (checked in this order) some proposed field's current declaration lists neither the proposal's handler `on` nor `owner` → `void` and `unwritable:key` emitted (EC-146), or some proposed field has moved since (`sameValue` against the snapshot base) → `void` and `stale:key` emitted. The writer of record is the proposing handler.
- **rebind** to a scheme whose state declaration differs refuses `rebindNeedsMigration`; otherwise the binding changes.

### 4.4 Calendar facts (time.ts)

Expectations are issued when a window opens and never before activation; windows tumble from the anchor (`day`: 1, `week`: 7, `days n`: n). Adherence is written by the `dayClosed` that ends the window: the occurrences in it that match the selector, `missed = max(0, n − met)` (0 if void); a window touching a pause or opened while lapsed is void. A late session appends an amendment (never edits adherence) and never moves a tracked last day backwards. Lapse: an active instance whose last occurrence (or activation) is `lapseAfterDays` or more before the closed day becomes `lapsed`; the next session reactivates it. `completedFraction` = met over expected across non-void windows, each window's met capped at expected; 1 when nothing was expected.

**The due verdict** (soft, immutable on the issued fact): over the caps (`atMost`, `minGap`, the latter's gap evaluated at prescribe and clamped to `ceiling`), `due` if none blocks today; else the first day within the horizon (the largest `ceiling` or `withinDays`) that none blocks, as `early{dueOn, rule}`; else `notBefore{day: today + horizon + 1, rule}`, a proven lower bound, never an invented date.

**Feasibility** (checker): pairwise, each `atLeast` against each cap whose selector contains it (`any` contains everything; otherwise only equal canonical selectors), over one cyclic hyper-period.

## 5. Silence

The absence causes (*generated*):

| cause | fields |
|---|---|
| `factUnknown` | `fact`, `key` |
| `factStale` | `fact`, `observedOn`, `maxAgeDays` |
| `stateUnset` | `field`, `noun` |
| `declaredNone` | — |
| `notPerformed` | `step` |
| `notTargeted` | `step`, `metric` |
| `emptyPick` | — |
| `missingKey` | `key` |
| `zeroDenominator` | — |
| `noPriorSession` | — |
| `outOfDomain` | `field`, `value` |
| `ownerCleared` | `field` |

Rules: a `none` carries its cause unchanged through `known` (which does not run its body) and is replaced only by `orElse`; arithmetic, comparison, indices and counts never meet a `none` (the checker's `absenceUnhandled`); at the sink an absent edge makes the field silent with that cause; a transformer leaves a silent field silent; the verdict skips a silent field (no load could be computed, so the athlete chose one); a stale fact is absent; a `none` initial state is `stateUnset` with the field's noun.

## 6. Laws

The laws as the engine states them (*verbatim* from `engine.ts`):

```
* LAWS (each has a property test in the implementation plan)
 L1 Totality.     Every well-typed term evaluates in finite time: no
                  fixpoint former; `app` resolves only versions published
                  BEFORE the caller (a DAG by time, checked: futureRef);
                  every iteration ranges over a finite collection or a
                  LITERAL bound; accumulators are ground.
 L2 Determinism.  evaluate is a pure function of (term, env). Ties in
                  pick/allocate break by declaration order; allocate's
                  full semantics are normative on its former (algebra.ts).
 L3 Single writer. Each state field DECLARES its writers (writableBy). A
                  patch may name a field only if the firing handler is
                  listed; an owner edit only if 'owner' is listed.
 L4 Commutation.  All handlers fired by one event read the same pre-state
                  and write disjoint fields. Structural: a handler yields
                  ONE patch record (keys unique), slot and program scopes
                  own disjoint state, and policies never write.
 L5 Idempotence.  The ledger is a set keyed by causeKey; a duplicate is a
                  no-op. State = fold of the ledger in INGESTION order.
                  Reconciliation is a set of per-day causeKeys; expectations
                  and adherence are keyed (instance, rule, window); progress
                  events are emitted atomically with the closure causing them.
 L6 Facts.        Issued prescriptions, due verdicts, expectations and
                  adherence are immutable. An open field closes by an
                  append-only Resolution; a late session appends an
                  AdherenceAmendment. Handlers read the issued snapshot.
 L7 Silence.      Absence is typed (Opt); a stale fact is absent. Sinks turn
                  absence into a silent target whose trace names the cause.
 L8 Describability. DESCRIBERS, DECL_DESCRIBERS and WIDGETS are total; every
                  library FnDef's holes equal its params and its examples
                  evaluate; every expression fits the phrase budget.
 L9 Honest projection. Every projected value is tagged with its assumption
                  model; `asScheduled` lays sessions on nominal days ("at 3
                  a week this block ends 20 Dec"); projection never writes.
 L10 Dose.        At the set sink, deload/taper/test weeks drop the
                  session's intensifier.
 L11 Training causes progress. The progress clock advances only on closed
                  training, an owner skip, or an `anchored` week end. A slot
                  boundary handler with no completed session of that slot
                  in its window records keep(untrained) and does not run.
 L12 Stamped reads. No term reads "now" or the live store. Every calendar
                  read evaluates at a stamped LocalDay, and every fact a
                  handler reads is the snapshot carried on its event; each
                  read is stamped with its value on the fact it produced.
 L13 Time alone never commits. Handlers on calendar-caused events
                  (periodClosed, lapse) may only propose or keep.
```

The laws section of the rationale (*verbatim*), including the two-clock law, the day-selection trust boundary and the index bases:

L1 to L10 stand, with these changes. L1's iteration list loses `iterate` and gains `range`. L2 points at `allocate`'s normative semantics. L4 is structural: a handler yields ONE patch record whose keys are unique, slot and program scopes own disjoint state, and policies never write, so no two writes of one event can touch the same field. L5 adds per-day causeKeys for reconciliation, expectations and adherence keyed (instance, rule, window). L6 adds due verdicts, expectations and adherence to the immutable facts, with late sessions appending amendments. L7 adds staleness as absence. L9 adds `asScheduled` projection on nominal days.

- **L11 Training causes progress.** The progress clock advances only on closed training, an owner skip, or an anchored week end. A slot boundary handler with no completed session of that slot in its window records keep(untrained).
- **L12 Stamped reads.** No term reads "now" or the live store. Every calendar read evaluates at a stamped day; every fact a handler reads, and every fact an outcome policy's `when` reads, is the snapshot carried on its event; each read is stamped with its value.
- **L13 Time alone never commits.** Calendar-caused handlers may only propose or keep. The checker refuses a committed field in a periodClosed patch (`timeCommit`), and the embedding's `periodClosed` context has neither `commit` nor `patch`.

**The two-clock law, restated honestly.** v2 claimed the clocks "never mix" while a rate literal per day, a days-to-weeks conversion, and a comparison of a calendar count with a progress count all checked. v3 states and enforces: plans MAY read the calendar; no calendar-derived value may index a progress schedule or feed arithmetic with progress-clock values. The checker enforces a slightly stronger rule, because state would otherwise launder a calendar value into a progress one: a calendar-derived quantity may be COMPARED (or key a threshold table, which is a comparison) but never stored, targeted, passed as an argument or used as an index. A rate per day or per week does not exist (`clockRate`); a progress value and a calendar value never meet in arithmetic or comparison (`clockMix`).

**The day-selection trust boundary.** The shell proposes the day to prescribe; the engine never picks it. The default the shell proposes is the rotation's next unmet day; the athlete may choose another, and a mismatch between the chosen day and the default is recorded on the issued session, never corrected by moving the workout (provenance). The engine trusts the day's identity (it must name a declared day) and nothing about its timing.

**Index bases.** Everything is 0-based: `pos.week` and `pos.trainWeek` (the first block week is week 0), `pos.slotSession`, a positional table's rows, `nth`, `range(n)` (0 … n−1), `performed(…, count)` (the 0-based index of the set being targeted), and `cal.earlierToday` (the sessions of this program already closed today; 0 for the first). The 1-based `cal.occurrence` of v2 is renamed and rebased.

### 6.1 R2 law decisions (*verbatim* from `rationale.md`)

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
- BV-25, BV-26 (owner-directed change 2026-10-04): ONE quantization law for the language. Every nearest quantization, the sink's plate fitting and an author's `round` to nearest alike, sends ties DOWN, toward −∞ (101.25 on a 2.5 kg grid is 100; 7.5 reps to the nearest rep is 7). Why: one law, describable in four words ("ties round down"); conservative for loads, so the sink never prescribes more than it computed; and an author who reproduces the sink's math with `round` gets the engine's number. Was: `round` sent ties up and the sink down. The formulation is pinned so every implementation agrees bit for bit (units.ts `nearestStep`): with Q = 10⁹, u = x ÷ step and v = u × Q are the only floating-point operations (IEEE-754 binary64, in that order); m = v rounded half away from zero; n = ⌈(m − Q/2) ÷ Q⌉ in exact integer arithmetic; the result is n × step. A tie is therefore any u within half a billionth of a step of a half-integer (40.5 + 3×10⁻¹⁰ steps is a tie and goes down; 40.5 + 8×10⁻¹⁰ goes up). When |m| > 2⁵² the operand is returned unquantized. `round` down and up keep their floors (`floor(k + 1e-9)`, `ceil(k − 1e-9)`).
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

## 7. Canonical JSON

- A fixture or definition file is JSON. Object keys appear in the order the oracle constructed them; that order is significant only for hashing (below). Numbers are IEEE-754 doubles printed shortest-round-trip.
- Runtime-only shapes have one encoding each: a set is `{"$set": [...]}` (unordered), a map `{"$map": [[k, v], ...]}`, a non-finite number `{"$num": "Infinity" | "-Infinity" | "NaN"}`, a registry `{"$registry": "<id>"}` naming `fixtures/registries/<id>.json`, a function-valued argument `{"$fn": "<id>"}` whose calls are recorded in the fixture's `world[id]`.
- Two sharing forms are expanded before a fixture is validated or compared: `{"$def": "id@version"}` is the corpus definition in `fixtures/defs/`, and `{"$ref": "#i/ret/<path>"}` is the value at that path inside the stored output of fixture `i` of the same file (which may itself contain `$ref`s). A path segment escapes `~` as `~0` and `/` as `~1`, as a JSON Pointer does (RFC 6901): a proposal key such as `proposal:week:prog/rp-upper-meso:0:program` is one segment.
- **Hashing (open item).** `stamp.programHash` and the `@xxxxxxxx` suffix of a `Resolution.key` are FNV-1a 32-bit (offset `0x811c9dc5`, prime `0x01000193`) over the UTF-16 code units of ECMAScript `JSON.stringify` of the program definition (respectively of the dependencies' logged sets), as 8 lowercase hex digits. This is a placeholder: it depends on key order and JS number formatting. Real content hashing and de Bruijn elaboration are unspecified (EC-212), so conformance does not require these digests (section 8).

## 8. Conformance protocol

1. Load `fixtures/defs/*.json` (one definition each) and `fixtures/registries/*.json` (`entries` in publication order, `vocab` `"base"` or inline). A registry is built by publishing the entries in order.
2. For each fixture (`fixtures/eval`, `fixtures/prose`: a file holds `{source, fixtures: [...]}`; `fixtures/refusals`: one fixture per file), decode `args` (positional, per the operation table below), replacing each `$fn` with a stub that answers each recorded call: a call is matched by its encoded arguments; repeated identical calls replay in order, then the last answer. A call that was never recorded is a **conformance failure**: the implementation read something the oracle did not (L12: reads are part of the stamped record).
3. Run the operation. If the fixture expects `{"throws": message}` the implementation MUST fail (any error; the message is the oracle's). Otherwise encode the result canonically and compare with `expected.ret` structurally: object keys as sets, arrays in order, `$set`s as multisets, numbers equal within `1e-9` relative. Arguments the oracle mutated are compared after the call against `expected.mutated[index]`.
4. Exempt from comparison (conformance mode): any `message` field (refusal and error text is informative), `programHash`, and the 8-hex-digit suffix after the last `@` of a hash-bearing key. The oracle's own replay compares these too (strict mode).
5. **Prose** fixtures compare the returned string or string list **exactly**. Locale assumptions (every prose fixture is tagged `en-GB (oracle)`): English words and plural rule `n = 1`; decimal point `.`, at most three decimals with trailing zeros dropped (`String(Number(n.toFixed(3)))`); no thousands separators; durations of a minute or more and paces as `m:ss`; dates as `Weekday D Month` (`Monday 12 October`), never with a year; ranges with an en dash (`8–12 reps`); every other character (curly quotes, `×`, `≥`) exactly as stored.
6. **Refusals** carry `expectedCode` and `expectedPath` (the first error). Compare the whole returned error list (codes, paths and fields, messages exempt). A refusal tagged `inputSchemaErrors` is authoring JSON that does not parse as IR; an implementation that parses strictly MAY reject it at parse, but MUST NOT accept it.
7. Operations name oracle entry points, some of them internal (`checker.top` is the term judgment over a raw `Scope`; the `describe-run.*` helpers are the issued-fact describers). An implementation supplies one adapter per operation it implements; the fixture counts per operation say how much each one carries.

### 8.1 Operations (*generated*; argument sorts are `ir-schema.json` `$defs`)

| operation | directory | arguments | returns | fixtures |
|---|---|---|---|---|
| `evaluate.evaluate` | eval | Term, Ctx | Trace | 175 |
| `issue.sinkField` | eval | Field, string, {load, distance} | Field | 14 |
| `issue.applyUse` | eval | Use, SessionValue, Ctx | SessionValue | 16 |
| `issue.currentView` | eval | IssuedSession, Resolution[] | IssuedSlot[] | 3 |
| `issue.resolveLive` | eval | {reg} \| Runtime, IssuedSession, Logged, Resolution[] | Resolution[] | 103 |
| `issue.setsDue` | eval | {reg} \| Runtime, IssuedSlot, IssuedStep, record of PerformedSet[] | Number | 2 |
| `xform.applyXform` | eval | XformOp, SessionValue, Value \| null, string \| null, string[] \| null | SessionValue | 3 |
| `judge.verdictOf` | eval | EventSource, string[] \| "working", Edge | VerdictTag | 4 |
| `step.activate` | eval | Runtime, record of Value, FactSource | Head | 22 |
| `step.step` | eval | Runtime, Head, Event | StepResult | 2 |
| `step.ingest` | eval | Runtime, Ledger, Event | {ledger, result} | 191 |
| `step.replay` | eval | Runtime, Head, Event[] | Ledger | 2 |
| `step.prescribe` | eval | Runtime, Ledger, string, FactSource, LocalDay | {ledger, issued} | 153 |
| `step.exportsOf` | eval | Runtime, Head | record of Value | 1 |
| `project.project` | eval | Runtime, Ledger, integer, Assume, FactSource, LocalDay, integer?, FactReading[]? | Projection | 38 |
| `project.projectMacro` | eval | RegistryToken, MacroDef, Assume, FactSource, integer, FactReading[]? | PhaseRun[] | 6 |
| `time.activate` | eval | CalendarSpec | CalendarState | 2 |
| `time.reconcile` | eval | CalendarSpec, CalendarState, LocalDay | CalEvent[] | 4 |
| `time.stepCalendar` | eval | CalendarSpec, CalendarState, CalEvent | CalendarState | 41 |
| `time.dueVerdict` | eval | CalendarSpec, CalendarState, LocalDay, FnToken | Due | 3 |
| `time.feasibility` | eval | Frequency[], integer | Infeasible \| null | 2 |
| `time.occurrenceOf` | eval | {workoutId, localDay, day, slots, startedEarly, totals, loggedSets}, CalendarSpec | Occurrence \| {refused, workoutId} | 8 |
| `time.completedFraction` | eval | CalendarState | Number | 1 |
| `time.calendarSpecOf` | eval | ProgramDef, Selector[], string, LocalDay, LocalDay | CalendarSpec | 25 |
| `checker.top` | check | Term, Scope, Path, Ty \| null, TypeError[] | {ty, cost} \| null | 58 |
| `checkdefs.checkFn` | check | FnDef, RegistryToken | TypeError[] | 11 (+ refusals) |
| `checkdefs.checkScheme` | check | SchemeDef, RegistryToken, any? | TypeError[] | 8 (+ refusals) |
| `checkdefs.checkProgram` | check | ProgramDef, RegistryToken | {at, errors}[] | 16 (+ refusals) |
| `checkdefs.checkMacro` | check | MacroDef, RegistryToken | TypeError[] | 2 (+ refusals) |
| `checkdefs.writeSet` | eval | SchemeDef \| ProgramDef | WriteEntry[] | 2 |
| `describe.describe` | prose | Term, Cx | string | 97 |
| `describe.phrase` | prose | Term, Cx | string | 1 |
| `describe-defs.describeProgram` | prose | ProgramDef, Cx | string[] | 16 |
| `describe-defs.describeSlot` | prose | SchemeDef, record of string, Cx, Calendar \| null? | string[] | 48 |
| `describe-defs.describeMacroPhases` | prose | MacroDef, Cx | string[] | 2 |
| `describe-defs.headline` | prose | ProgramDef | string | 1 |
| `describe-defs.macroHeadline` | prose | MacroDef | string | 2 |
| `describe-defs.stackingText` | prose | ProgramDef, Cx | string[] | 2 |
| `describe-defs.dueText` | prose | Due, CalendarSpec, FnToken, Cx | string | 3 |
| `describe-defs.adherenceText` | prose | CalendarState, Adherence, CalendarSpec | string | 10 |
| `describe-defs.bindingArgs` | prose | ProgramDef, SlotBinding, Cx | record of string | 41 |
| `describe-run.sessionText` | prose | IssuedSession, RegistryToken | string[] | 146 |
| `describe-run.valueText` | prose | Value, RegistryToken | string | 33 |
| `describe-run.explain` | prose | Trace, RegistryToken | string | 6 |
| `describe-run.transitionText` | prose | Transition, RegistryToken, FnToken | string[] | 34 |

## 9. Constants

`BUDGET = 4` operator nodes between name boundaries; `cal.recent` windows are literal, 1 to 56 days; a frequency period is at most 28 days; the default lapse is 21 days; numeric tolerance `1e-9` (relative for comparison, absolute for floors).
