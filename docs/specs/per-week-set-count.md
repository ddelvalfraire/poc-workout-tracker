# Per-week set count

Why a week cannot pin its own set count, what varies set count today, and exactly what a per-week editing surface may promise.

- Status: decision / no schema change
- Date: 2026-08-22
- Pinned by: `src/lib/per-week-set-count.test.ts`

## 01 · The contradiction

Program mocks show per-week **set count** varying — "Lat Pulldown is 4×10 in most weeks but 5×10 in week 5" — and a confirmation sheet offering *just this week / this week onward / change the rule*.

`program_set_overrides` cannot store that. It is keyed `(program_set_id, week)` and carries FIELD values only (`repMin`, `repMax`, `rir`, `rpe`, `suggestedLoadKg`, `tempo`, `durationSec`, `distanceM`, `restSec`, `technique`). Its schema comment states the rule: *`setType`/`metricMode` are deliberately absent — changing a set's shape is an edit, not a week override.* There is no presence or count dimension, so "5 sets this week only" has nowhere to live.

## 02 · Decision

**Set count stays out of the override table. It is a rule or an edit, never a per-week pin.** No schema change, no new column, no `omitted` flag.

The engine already varies set count per week — in exactly one place, `resizeWorkingSets` in `src/lib/programs/progression.ts` — driven by two RULES:

| Rule | Where | Shape of the variation |
|---|---|---|
| `deloadPolicy.shape.setFactor` | resolved policy, `deriveWeekSets` | The scheduled deload week's working-set count is `max(1, ceil(count × setFactor))`. Default 0.5 — 4 sets become 2 in the deload week, every other week untouched. `'none'`/`'reactive'` leave the count alone. |
| `weekly-volume` scheme | `volumeSetCount`, `deriveWeekSets` | A monotone MEV→MRV ramp across the block's non-deload weeks: 3, 4, 5, 6. |

So *"does `setFactor` already vary set count per week?"* — **yes, it does, and it settles the question of ownership.** It shows that per-week set count is a supported idea in this codebase and that its owner is the RULE layer, not the override layer. `setFactor` is one number on the program that answers for every exercise and every deload week; it is derived at read time, never stored per `(set, week)`. The weekly-volume ramp is the same story at exercise grain. Adding a stored per-week count would put a second, differently-grained answer next to two rules that already speak — the thing the single resize step is deliberately structured to avoid.

Three further properties make the rule layer the only coherent home:

1. **Count varies at the TAIL only.** `resizeWorkingSets` shrinks by dropping working sets from the end and grows by CLONING the last one. Sets 1..n−1 keep their identity across weeks, which is what lets an override — keyed to a base set — stay meaningful in a week whose count differs. A presence flag per `(set, week)` would let a MIDDLE set vanish; derived `setNumber`s are renumbered 1-based contiguous at the end of derivation, so week 3's "set 3" would be a different exercise position from week 4's.
2. **Grown rows have no set identity of their own.** A cloned tail row carries the base row's `sourceIndex`, so a week-5 override on base set 4 lands on the 4th *and* 5th row. A per-week count pin therefore has no per-set answer to "what is this new set's prescription?" beyond "a copy of the last one" — which is precisely what a rule already gives.
3. **A dropped set's override is inert, never a resurrection.** Overrides are merged onto derived rows AFTER the resize (`deriveDayPrescription`). An override can only ever change a set the week already has.

Options weighed and rejected:

- **(a) A presence/count dimension on the override row** (e.g. nullable `omitted`, with the extra set living in the base rows). Rejected: it inverts what a base row means — the template stops being what you actually train — and it makes the resize step ambiguous. Does an omitted row count toward `workingCount` before `setFactor` scales it? Is a set omitted in the deload week omitted *before* or *after* the halving? Two mechanisms, one output, no stated composition. It also breaks the tail-only invariant in (1).
- **(c) A new `(program_exercise_id, week)` explicit working-set count.** The best of the storage options — right grain, and it would feed the existing single resize step with a stated precedence (pin > deload > scheme). Rejected on cost against value: it needs a table, a migration, upsert-survival in the full-replace path, `get_program` exposure, an MCP patch tool, a patch-proposal arm, and change-log summaries — and it fights the two rules for the same output for the sake of a one-off spike that a rule change or an edit already expresses. Revisit only if authors demonstrably need arbitrary non-monotone per-week volume that neither the ramp nor a block edit can express.

Nothing here weakens the standing laws: prescriptions are snapshotted at instantiation, so any count change — rule or edit — moves the FUTURE, never a logged session.

## 03 · What a UI may and may not promise

### May promise

- **"Just this week"** — for **field values only**: load, rep min/max, RIR, RPE, tempo, rest, duration, distance, technique. This is `set_program_set_override` / `remove_program_set_override`, and it wins over the engine *and* the deload modifier for that week.
- **"Change the rule"** — for anything about set count:
  - the deload policy (`setFactor`, `loadFactor`, `rpeCap`, `timedExercises`) — a program-level dip in the deload week;
  - a `weekly-volume` progression (`mevSets` → `mrvSets`) — an exercise-level ramp across the block.
- **"Change the plan"** — add/remove/update a set row (`add_program_set`, `remove_program_set`, `update_program_set`). Say plainly that this changes **every week that has not already been logged**, not just this one. That is the honest description of a base-row edit against a block whose past weeks are snapshotted facts.
- **Displaying a different set count for different weeks.** The week preview is authoritative: `preview_program_week` runs the same derivation instantiation seeds, so a deload week legitimately shows fewer rows and a volume ramp more.

### May not promise

- **"5 sets in week 5 only"** as a per-week pin. There is no storage for it and no tool that accepts it. A surface offering it would either silently no-op or silently rewrite the plan for every week.
- **"This week onward."** Nothing in the schema is week-ranged. An edit is not scoped to a week, and an override covers exactly one week. If the product wants forward-only semantics, the existing shape of the answer is a **new block**: clone the program and edit the clone (block restart), not a third write mode.
- **Removing a single set for one week** ("skip set 4 this week"). Same absence, same reason — and a skipped middle set would renumber the rest.
- **Set shape changes as a week pin** — `setType` (working/backoff/amrap/warmup) and `metricMode` are edits by the same rule that excludes count.
- **That planned weekly volume reflects a given week's count.** `db/planned-volume.ts` counts `program_sets` ROWS; it does not run the engine. Deload dips and volume ramps are already invisible to it. Do not label a planned-volume figure "this week".

### Copy that fits

A two-option sheet, not three:

> **This week only** — load, reps, RIR/RPE, rest, tempo. *(pins the week)*
> **The plan** — sets, set type, everything else. *(applies to every week you haven't logged yet)*

And where an author asks for fewer or more sets in a specific week, route them to the rule that expresses it: the deload policy for a planned dip, a `weekly-volume` progression for a ramp.
