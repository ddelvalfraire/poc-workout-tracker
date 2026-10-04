## Typing

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
- `weekly`: metric `sets` gives `SETS`; else registry lookup (`unknownName`). Options, in this order: `basis` other than `closing`/`upcoming` is `unknownName { name: basis }` at `p/q/basis`; `roles` neither `all` nor an array is `unknownName` at `p/q/roles`; an empty array is `literalDomain { former: 'agg', field: 'roles', value: 0 }` at `p/q/roles`; the first entry that is not a week role (`registry.ts` `ENUM_VALUES.weekRole`) is `unknownName { name }` at `p/q/roles/i`. The result sort is `opt(metric sort)` when `basis === 'upcoming'` or `roles` is an array, else the metric sort (an explicit default is the same as an omitted one). `by.k === 'tag'`: when `scope.program` is non-null and lacks the tag, `unknownName { name: tag }` at `p`; else the metric sort. Else sub `q/by/of`, `expect(ref by.k)` at `p/q/by/of`.

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
