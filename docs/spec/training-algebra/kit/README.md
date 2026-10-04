# Language handoff kit: training-program algebra (v3 + R2)

This kit lets a second implementation (the target is Rust) be built and proven against the TypeScript oracle in `../oracle/` without reading TypeScript. It holds the IR's JSON Schema, the worked corpus as canonical IR, and the oracle's recorded behavior as conformance fixtures. Nothing here is hand-maintained: `verify.sh` step 8 regenerates all of it from the oracle and proves it on every run.

## Layout

- `SPEC.md` is the normative specification: sorts, typing, evaluation per former, issuance, stepping, the calendar, silence, the laws L1 to L13 and the R2 law decisions verbatim, canonical JSON, and the conformance protocol with the operation table.
- `ir-schema.json` is the JSON Schema (draft 2020-12) of the IR and of every runtime shape a fixture carries. Its root validates one definition; `#/$defs/FixtureFile`, `#/$defs/RefusalFile` and `#/$defs/RegistryFile` validate the fixture files.
- `fixtures/defs/` holds every worked definition, one per file, named `<id with / as .>@<version>.json`: the library functions and schemes, the programs and the two macros.
- `fixtures/registries/` holds each registry a fixture runs against: its publication log (`$def` keys or inline definitions, in order) and its vocabulary.
- `fixtures/eval/` holds one file per test scenario: `{source, fixtures: [...]}`, each fixture `{op, args, world, expected}`. A scenario's fixtures run in order and later ones share earlier outputs by `$ref`, so an event sequence reads as a chain: activate, prescribe, ingest, ingest, ...
- `fixtures/refusals/` holds one refused input per file, with `expectedCode` and `expectedPath`, self-contained.
- `fixtures/prose/` holds describer calls with the exact expected text, tagged with the zoom and the locale.
- `fixtures/manifest.json` records what the generator sampled, dropped and could not export.

## Regenerating

Run `./verify.sh` in `../oracle/`. Step 8 copies the package to a scratch directory, rewrites every operation in `OPS` (`kit.ts`) there to call the recorder (`kit-verify.ts tap`), and runs the suites (`semantics.test.ts`, `laws.test.ts`, `conformance.ts` with `differential.ts`, `demo.ts`, then `hardening.test.ts`, `coverage.test.ts`, `semfix.test.ts` and `weekbasis.test.ts`) unchanged under it (`kit-gen.ts`, `kit-record.ts`). Each top-level call a test makes becomes a fixture; calls the oracle makes inside another are part of that fixture's behavior, not fixtures of their own. Then `kit-verify.ts check` writes `ir-schema.json` (`kit-schema.ts`), validates every file against it, replays every fixture on the untouched oracle and diffs the result with the stored output, renders this file and `SPEC.md` from `kit-readme.md` and `kit-spec.md`, and fails on any invalid file or mismatch.

The generator source lives beside the oracle so it is type-checked with it (step 1): `kit.ts` (the codec, the comparator, the operation table), `kit-schema.ts` (the schema, built from the TS declarations and runtime mirrors, and the validator), `kit-record.ts` and `kit-gen.ts` (the recorder), `kit-verify.ts` (the tap and the check), `kit-spec.md`, `kit-spec-typing.md` and `kit-readme.md` (the document templates), `kit-shim.d.ts`.

## Counts

| directory | files | fixtures |
|---|---|---|
| fixtures/defs | 44 | 44 |
| fixtures/registries | 12 | 12 |
| fixtures/eval | 178 | 1317 |
| fixtures/refusals | 298 | 298 |
| fixtures/prose | 68 | 456 |

Compile-time and ingest refusal codes with at least one refusal fixture: 49 of 50. Codes with none: `dayStampOutOfRange`, `floorNotConfirmed`.

Refusal fixtures whose input is authoring JSON that does not parse as IR (tagged `inputSchemaErrors`; the checker still answers them, and the schema is stricter than the checker there): 

- boundNotLiteral: conformance.boundnotliteral.2.json
- boundNotLiteral: conformance.boundnotliteral.4.json
- boundNotLiteral: a threshold given as a term
- unknownName: a weekly read filtered to a misspelt week role
- boundNotLiteral: allocate bound given as a term
- unknownName: both(commit tm, commit tm = 50 kg): the v2 outcome pair
- unknownName: division (not a former in v1)
- unknownName: iterate (cut: fold over range covers it)
- unknownName: the v2 two-valued hitAll read
- boundNotLiteral: hardening.boundnotliteral.2.json
- unknownName: hardening.unknownname.10.json
- unknownName: hardening.unknownname.11.json
- unknownName: hardening.unknownname.13.json
- unknownName: hardening.unknownname.16.json
- unknownName: hardening.unknownname.17.json
- unknownName: hardening.unknownname.2.json
- unknownName: hardening.unknownname.3.json
- unknownName: hardening.unknownname.4.json
- unknownName: hardening.unknownname.json
- literalDomain: weekbasis.literaldomain.json
- unknownName: weekbasis.unknownname.2.json
- unknownName: weekbasis.unknownname.json

Sampling and what was not exported:

```json
{
 "capPerTestAndOp": {
  "evaluate.evaluate": 24,
  "issue.applyUse": 16
 },
 "sampledOut": {
  "evaluate.evaluate": 1496,
  "issue.applyUse": 87
 },
 "duplicatesDropped": 2020,
 "notExported": {
  "step.activate: codec: a registry whose definitions and publication order disagree": 6,
  "step.prescribe: codec: a registry whose definitions and publication order disagree": 4,
  "issue.resolveLive: codec: a registry whose definitions and publication order disagree": 7,
  "evaluate.evaluate: a call of arg1.record cannot be encoded: codec: undefined at $": 5
 }
}
```

The two sampled operations are the evaluator calls of L1 (200 random argument sets per library function) and the policy-composition sweeps; at most the listed number per test is kept. Duplicates are identical calls (same operation, arguments and world) made by more than one test.

## Schema coverage

A branch is exercised when some fixture file's data takes it (definitions, registries, inputs and outputs alike). The right column lists what no corpus definition uses, so a Rust implementation sees those only in fixtures.

| union | branches | not exercised by any fixture | not in any corpus definition |
|---|---|---|---|
| Term | 47 | — | not, range, sum, count, pick |
| AnyDef | 4 | — | — |
| Lit | 5 | — | — |
| Ty | 10 | — | upd |
| BoundIR | 5 | — | open |
| Count | 4 | — | until |
| StepIR | 2 | — | — |
| Selector | 5 | — | slot, day |
| Measure | 3 | — | count, sum, max |
| CalQuery | 4 | — | earlierToday, gap, recent |
| EventQuery | 8 | — | e1rm, trained, week, groupScore |
| AggQuery | 2 | — | — |
| Group | 5 | — | emom, amrapFor |
| Rotation | 4 | — | pattern |
| Period | 3 | — | day, days |
| Frequency | 3 | — | atMost |
| Length | 3 | — | — |
| ExportDecl | 1 | — | — |
| XformOp | 8 | — | swapExercise, addSets |
| TypeError | 43 | — | unitMismatch, notComparable, absenceUnhandled, unknownName, missingArg, forwardStepRef, capabilityEscape, notOwner, notWritableHere, undeclaredFact, nonGroundAccumulator, nonExhaustive, boundNotLiteral, templateHoles, exampleFailed, futureRef, peakNeedsFixed, overBudget, metricNotLogged, shapeNotAllowed, scopedFormer, infeasibleFrequency, timeCommit, anchoredRequired, restOwnedByGroup, windowTooLong, primaryMuscle, boundsInverted, openNotLast, fixedNeedsOnce, emomNeedsFixedCount, importMismatch, clockMix, clockRate, loggingMismatch, nExceedsMax, unlabeledLet, thresholdOrder, tableShape, roleDoubleEncoding, noSuchKind, policyOrder, literalDomain |
| IngestRefusal | 8 | dayStampOutOfRange, floorNotConfirmed | emptySession, notALocalDay, dayStampOutOfRange, programComplete, floorNotConfirmed, instanceClosed, notOwnerWritable, rebindNeedsMigration |

Term formers that no evaluation fixture's trace shows being evaluated: none.

`Ty.upd` is the sort the checker gives a handler's patch: it appears in `checker.top` outputs, never in an authored definition. The coverage table covers the grammar's unions; enumerations (units, scales, roles) are validated but not listed.

## For the Rust side

1. Generate types from `ir-schema.json` or write them by hand against it; validate `fixtures/defs` first.
2. Implement the codec of `SPEC.md` section 7 and the stub world of section 8: the fixture harness needs it before any operation runs.
3. Work through the operation table in `SPEC.md` 8.1 in this order: `evaluate.evaluate` (the formers), `issue.sinkField` and `xform.applyXform`, `checker.top` and the `checkdefs.*` checks with `fixtures/refusals`, `time.*`, `step.activate` / `step.prescribe` / `step.ingest` / `step.replay`, `issue.resolveLive`, `project.*`, then the describers with `fixtures/prose`.
4. Compare in conformance mode (`SPEC.md` 8, item 4). The oracle's own replay uses strict mode.

## Intentionally unspecified (open items inherited from R2)

- **Content hashing and de Bruijn elaboration (EC-212).** `programHash` and resolution keys carry an FNV-1a placeholder over JS `JSON.stringify` (SPEC 7); conformance exempts them. Binder variable names in the corpus (`v123`) come from the embedding's construction order; they are names, not indices, and a Rust implementation must treat them as opaque.
- **WIDGETS, `irSchema`, `describeDiff` and the exact zoom (EC-198, EC-211, EC-210, EC-204)** are R7 surfaces, still signatures in `engine.ts`. `ir-schema.json` is this kit's answer to `irSchema` for interchange, not the R7 widget surface. Prose fixtures cover the `intent` and `mechanism` zooms only: the describer (`describe.ts` `Zoom`) implements no `exact` zoom, so there is nothing to record for it until R7 builds one.
- **The issued fact does not carry a day's group shape** (superset and circuit rest, EMOM rounds); groups only order the slots. The logger needs it at R7.
- **No owner `phaseAdvance` event** in the macro runtime: `projectMacro` decides advancement itself, so `floorNotConfirmed` has no fixture, and peakOn's `startedLate` skip is not implemented.
- **Rebind with a state migration** is refused (`rebindNeedsMigration`) rather than implemented: the grammar has no record sort to write one in.
- `dayStampOutOfRange` needs the instant, which only the boundary (R4) has: no fixture.
- An open field's frame captures only reads whose variables are bound at issue; a live target reading a fact keyed by an inner binder variable would fail at resolution. No worked program does this.
- The differential is numeric: prose fixtures pin the words exactly, but only the numbers were ever proven against evaluation.
