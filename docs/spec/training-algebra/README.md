# Training algebra

This directory is the frozen v3 specification of the training algebra, the language that defines programs, progression, and prescriptions. It has three parts.

- `oracle/` is the executable specification. A strict TypeScript package whose behavior defines the language. `oracle/rationale.md` explains each design choice.
- `kit/` is the conformance kit for a second implementation. It holds `SPEC.md`, the IR's JSON Schema (`ir-schema.json`), the worked corpus as 44 canonical definitions and 12 registries, and 1,903 fixtures recorded from the oracle (1,959 schema-validated files in all). Where `SPEC.md` and a fixture disagree, the fixture is normative.
- `design/` holds the briefs, specs, decision memo, and test corpus the language was designed from. `trail/` holds the decision log (`decisions.tsv`) and the prompts of the last three rounds.

None of this is app code. The root `tsconfig.json`, `eslint.config.mjs`, and `vitest.config.ts` exclude this directory, and nothing in `src/` imports it.

## Verify

From the repo root, after `npm install`:

```sh
docs/spec/training-algebra/oracle/verify.sh
```

It runs eight steps in about 20 seconds. They are the strict typecheck, the negative type tests, the demo transcript, the construct counts, the property suites, conformance, the test-plan disposition, and the kit. Step 8 regenerates `kit/` from the suites, validates every file against the schema, and replays every fixture on the oracle. A clean run leaves `git status` unchanged. `BIN` overrides where `tsc` and `tsx` come from (default: the repo's `node_modules/.bin`).

## Production is Rust

The owner ruled that production runs on a Rust core, not on this TypeScript package. The TypeScript package is the specification and oracle. The kit's fixtures are the conformance contract the Rust crate must pass. Delivery plans written before that ruling (the R3 to R7 rounds in `design/replan.md`) are superseded as a delivery vehicle; their obligations carry over.

Before the crate API freezes, read `design/seam-open-items.md`. It lists what the Rust implementation and the app seam must resolve, including amended workouts, where `step` runs, definition hashing, and where prose is generated. The fixtures prove the oracle is deterministic. They do not prove its answers are right.

## Frozen snapshot

This is the ratified package plus its semantics review round. The earlier v1, v2, and v3 synthesis snapshots and the pre-ratification kits are intentionally not archived; `trail/decisions.tsv` records how the design got here. If the oracle and any older document disagree, the oracle wins.

After ratification, a three-reader adversarial semantics review drove one more round. It made 23 fixes and 5 portability pins (`design/semantics-fix-spec.md`), each guarded by the 49 regressions in `oracle/semfix.test.ts`; `trail/arena2/semfix-prefix.txt` shows them failing against the pre-round oracle.
