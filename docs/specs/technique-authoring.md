# Technique Authoring

The authoring surface for `technique` — drop-set / rest-pause / myo-reps /
cluster — and the one representation change it forces: a stage load that can be
stated as a PERCENTAGE of the set it drops from, so a technique survives the
progression that moves the set under it.

Consuming a technique is built (`docs/TECHNIQUE-LOGGING.md`, Model A: stages
become rows). Writing one is not: the only thing in the app that can author a
technique today is an MCP tool. That doc's "What is still open" names this
first.

- Status: draft / codebase-verified / no implementation
- Date: 2026-08-27

## 01 · What exists

| Fact | Where | Consequence |
|---|---|---|
| `techniqueSchema` is `{version, kind, stages[{loadKg?, reps?, restSec?}]}`, `.strict()` | `src/lib/program-input.ts:101` | The stored shape is small and already round-trips every write path |
| `technique` is a column on `program_sets` AND `program_set_overrides` | `src/db/schema.ts:909`, `:971` | A technique can be authored per plan and replaced per week |
| A per-week override replaces the WHOLE technique object | `src/lib/progression.ts:200` | There is no partial per-week edit of a stage |
| `ProgramSetPatch.technique` is written by `addProgramSet` / `updateProgramSet` / `setProgramSetOverride`, each re-parsed via `parseTechnique` | `src/db/program-patches.ts:1444`, `:1480`, `:1525`, `:1848` | **The write path is complete.** This spec adds no patch helper |
| Reachable over MCP as `update_program_set` | `src/lib/mcp/program-patch-tools.ts` | The agent can author a technique; the owner cannot |
| Stage rows are expanded at derivation, inheriting the top set's chassis | `src/lib/technique.ts:112` (`expandTechniqueStages`) | Stage authoring is a plan-time act with a derive-time consequence |
| Group volume weight: top 1.0, later stages 0.5; cluster 1.0 whole | `src/lib/technique.ts:184` (`stageVolumeWeight`) | Authoring changes weekly volume, so the surface owes the number |
| No row of a technique group testifies to auto-regulation | `db/autoreg-history.ts`, settled in TECHNIQUE-LOGGING.md | Adding a technique SILENCES autoreg for that exercise |

**Position.** This spec adds a representation (`loadPct`), the derive-time
resolution for it, and one authoring surface. It adds no table, no column, and
no migration.

## 02 · The representation problem

`expandTechniqueStages` takes each stage's load verbatim:

```ts
loadKg: stage.loadKg ?? null,     // src/lib/technique.ts:141
```

Nothing scales it. Meanwhile the set it drops from is derived per week —
progression scheme, then autoreg, then the per-week override
(`db/prescriptions.ts`). So an absolute stage load decays against its own top
set:

| | Top set (derived) | Authored drop | Actual drop |
|---|---|---|---|
| Week 1 | 100 kg | 80 kg | −20% |
| Week 6 | 115 kg | 80 kg | −30% |

The lifter authored a technique and is running a different one by week 6. The
only escape today is a per-week override that restates the entire technique
object by hand, for every week.

This is not a bug in the engine — absolute loads are right for the case where
the number IS the point (a fixed dumbbell, a machine's pin). It is a missing
alternative.

### The decision

Add `loadPct` to the stage, **mutually exclusive with `loadKg`**, resolved at
derivation against the stage's top set and quantized to the loadable grid.

```jsonc
// stage, after
{ "loadKg": 80,   "reps": 8 }   // absolute — this exact weight
{ "loadPct": 0.8, "reps": 8 }   // relative — 80% of what the top set derives to
{                 "reps": 8 }   // neither — captured at the rack (unchanged)
```

Three states, three meanings, none of them a default for another. The absent
case keeps the rule TECHNIQUE-LOGGING.md already settled: a stage with no load
starts blank and the lifter types what they actually dropped to; it is **never**
inherited from the top set, which would be a phantom prescription.

### Why this is cheap

`technique` is a **jsonb** column validated by zod at the boundary. An optional
field is a schema change, not a DDL change: **there is no SQL migration**, and
every stored row parses unchanged because `loadPct` is optional. (This was
scoped as costing a migration; it doesn't.)

The cost is three edits and their tests:

1. `techniqueSchema` — add `loadPct`, refuse both loads on one stage.
2. `expandTechniqueStages` — resolve pct against the top set's load.
3. Its signature — it needs the unit to quantize (§03).

MCP inherits the field for free: `update_program_set` validates through the same
schema, so the agent can author percentages the day the schema lands.

## 03 · Resolution semantics

The engine's contract, stated once and obeyed by the preview:

| Rule | Behaviour |
|---|---|
| Both `loadKg` and `loadPct` present | **Parse error.** Not a precedence rule — a stage means one thing |
| `loadPct` present, top set's derived load is a number | `quantizeLoadKg(top × pct, unit)` (`src/lib/load-quantize.ts`) |
| `loadPct` present, top set's derived load is `null` | Resolves to `null` — the captured case. A percentage of nothing is nothing, and inventing a number here is the phantom prescription the doc already banned |
| `loadPct` on a timed set (`duration` / `duration_distance`) | Resolves to `null`. `durationSec` is never multiplied by a load factor — the same rule the deload shape follows |
| Range | `0 < loadPct ≤ 2`. Above 1.0 is legal — an ascending cluster is a real thing |

Quantization matters for the same reason it does at derivation (#226): the drop
has to land on a weight the lifter can actually load, in the unit they read.
`quantizeLoadKg` already does this and is already applied to derived loads, so a
resolved stage load compares like-with-like against its top set.

**Signature change.** `expandTechniqueStages(sets)` has no unit today. It gains
one — `expandTechniqueStages(sets, unit)`. There are two production call sites,
not both in `db/prescriptions.ts` as first scoped: `prescriptions.ts:659`
(inside `instantiateProgramDay`, which reads the request-memoized
`getWeightUnit`) and `app/workout/[id]/edit/page.tsx:94`, which already takes
`unit: WeightUnit` as a parameter and uses it for `autoregReason`.

## 04 · What the built logger imposes on this surface

Settled elsewhere; the authoring surface may not contradict them.

- **Volume is weighted, not counted.** Top stage 1.0, each later stage 0.5; a
  cluster group is 1.0 whole however many blocks. Authoring three drops does not
  add three sets to the week's volume, and the surface should say what it does
  add.
- **Autoreg goes silent.** No row of a technique group testifies to
  auto-regulation — these methods are failure work, and a rep floor would read
  the technique working as a missed target. Adding a technique to an exercise
  therefore removes it from stall detection and load adjustment. **This is the
  most consequential thing authoring a technique does, and it is invisible in
  the mock.** It belongs at the point of choosing, not in a help sheet.
- **Kind is a label.** The logger branches only on "is the next row in this
  group?". Kind drives the glyph, the name, and the cluster volume exception —
  nothing else. The picker chooses a label and a volume rule; the stage
  parameters do the real work.
- **Stage rows inherit the chassis.** setType, metricMode, effort targets, tempo
  and sourceIndex come from the top set; a stage overrides only its load and its
  reps. The form has no business offering the others per stage.

## 05 · The surface

`SubTechnique.dc.html` (S2) is the design of record: Blender's modifier stack,
not a repeated fieldset. Stages are ordered rows, each stating its own numbers;
"The set becomes" renders the stack's output in the logger's own grammar, so the
authoring surface and the training surface agree before it is ever trained.

Three things the mock leaves open, decided here:

### Per-stage load mode

Each stage row's load field carries a mode control — the column-header idiom
from E2, where the header IS the control. Tapping `KG` switches that stage to
`%`, converting the value on the way (80 kg off a 100 kg top set becomes 80%,
quantized back on resolve). Clearing the field is the third state, and it is
labelled rather than blank: **"typed at the rack"**.

Mixed modes within one stack are legal and useful — a drop to a fixed dumbbell
after a percentage drop — so the mode is per stage, never per technique.

### The disabled-stage toggle has nowhere to live

The mock shows stages as "individually toggleable, and a disabled stage stays
visible with its numbers intact". **The schema has no `enabled` flag**, and
adding one would be cross-cutting: `expandTechniqueStages`, `stageVolumeWeight`,
the wire's contiguity check and the logger's group membership would each have to
learn to skip a stage.

Spec position: the toggle is **form-local**, not stored. Toggling a stage off
removes it from the object that gets saved; the editor keeps its numbers in
component state so the row stays visible and restorable while editing, and
`docs/specs/program-edit-undo.md` covers getting it back after a save. A stored
`enabled` flag is worth revisiting only if authors report losing stacks they
meant to keep.

### Preview is the document

As with progression (S1), the projected output is the page and the stack is the
formula bar. "The set becomes" shows the real derived rows for the week being
edited, with resolved loads — so a percentage stage shows the kg it will
actually prescribe — and the volume line states the weighted number
(`1.0 + 0.5 × n`, or `1.0` for a cluster) rather than a set count.

## 06 · i18n

Namespace per component; kind names come from the existing `TECHNIQUE_LABEL_KEY`
map (`src/lib/technique.ts:38`) and are **not** re-written here. New leaves are
the mode words, the consequence sentences and the preview's labels. The file
joins `I18N_MIGRATED` in the PR that creates it.

## 07 · Test anchors

- A stage carrying both `loadKg` and `loadPct` fails `techniqueSchema.parse`.
- `loadPct: 0.8` on a top set deriving to 100 kg resolves to 80 kg; on the same
  set at 115 kg it resolves to 92 kg — the §02 decay is gone.
- A resolved percentage goes through `quantizeLoadKg`, so an 82.7 kg result
  lands on the grid for the reader's unit.
- `loadPct` with a null top-set load resolves to null, not 0.
- `loadPct` on a `duration` set resolves to null and leaves `durationSec` alone.
- A stored technique with no `loadPct` anywhere derives byte-identically to
  today — the regression that proves this change is additive.
- Weekly volume for a 1-top + 2-drop group is 2.0, and 1.0 for a cluster, before
  and after the change.

## 08 · Out of scope, and open questions

### Out of scope

- **Total-reps progression** for rest-pause / myo-reps / drop sets — the "beat
  the logbook" rule TECHNIQUE-LOGGING.md leaves open. Until it exists a
  technique exercise gets no autoreg verdict, and this surface says so.
- **Per-week technique editing.** The override column can hold one, but a
  per-week stack editor is a second surface; v1 authors the plan's technique.
- **History and share surfaces** rendering the grouping the logger shows.

### Open questions

- **Does `loadPct` resolve against the top set's DERIVED load or its authored
  template load?** Spec takes derived — it is what the lifter will actually
  lift, and it is what keeps the percentage stable across the block. The
  counter-argument is that autoreg can move the derived load, so the drop moves
  for a reason the author did not choose. Derived still wins: the alternative is
  a percentage of a number the lifter never sees.
- **Does a percentage stage need its own glyph in the logger?** It resolves to a
  plain prescribed load, so probably not — but a lifter who authored "−20%" may
  want to see that rather than only the kg.
- **A cluster with `loadPct` above 1.0** is legal per §03, but no preset offers
  one. Confirm before shipping a preset that does.
