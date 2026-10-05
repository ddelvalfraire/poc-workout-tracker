# Arena round 2 synthesis: the training-program algebra

## Base

Candidate opus ("a total language with named functions"). Both my end-to-end read and the cross-judge (run on the sonnet family this round, with verification by execution) picked it. Judge scores: opus 26, sonnet 21, fable 17 out of 30. It is the only candidate combining a WORKING describability prototype on both hard cases (three-zoom prose over the real IR, output shipped), a sound scope story (single-writer ownership at every scope, RP allocation writing program.extra which slot plans read), the deepest type system (dimension exponent vectors, ordinals that never add, exhaustive matching, a peak anchor that only admits fixed-length phases as a TYPE rule), and the most complete worked programs (all four 5/3/1 lifts with BBB, canon-exact GZCLP with a retest stage, RP with SFR-ranked allocation, a five-phase OPT macro with bounded phase advance and arithmetic handoffs). Verified: all files typecheck strict, all nine negatives fire, the demo output matches the shipped transcript.

## The synthesis decision on the central tension

All three candidates chose power and bought prose back by forcing NAMES. The synthesized mechanism layers them:

1. **Derived prose is the guaranteed floor** (from the base + sonnet's execution evidence). Every term former has a describer in a mapped-type table; a former without one does not compile. Mechanism and trace zooms are therefore total for every expressible program. Judge-flagged fix folded in: binder names derive from the collection's SORT (a fold over slots says "each exercise", over muscles "each muscle"), never hardcoded per demo.
2. **The budget forces naming** (fable's `named(noun, e)` + static phrase budget, concretely implemented as sonnet's running `cost` checker with its `undescribable: cost N > 4; name an intermediate quantity` refusal). This is the base's proposed "intent-length lint" made a compile refusal. Calibration of the budget is tuned on the worked programs before it hardens.
3. **Intent templates are curated overrides, not the guarantee** (base). A named definition's `says` template must have holes exactly equal to its params, must pass evaluated examples, renders with the generated mechanism one tap away, and non-library definitions carry an "author's wording" marker. Prose can therefore be fluent where curated and is never absent or silently wrong-by-omission.
4. **Numbers always explain themselves** (base): evaluation traces cut at named definitions; transition reasons are the trace of the condition path, never author-written strings. The free-text `why`/`noun` lie surface the judge flagged in fable and sonnet does not exist: nouns come from declarations, reasons from traces.
5. **Tables render their data** (fix for the judge's sonnet flag): schedule/bands describers render the rows, so "the 5/3/1 percentages" shows 65/75/85.

## Grafts folded into the base

From fable:
- The capability phantom parameter with position-granted sets (PrescribeCap / LiveCap / FoldCap / OwnerCap, `elem` discharged inside aggregation binders). This moves the base's biggest type gap (performed-set reads legal anywhere in the TS embedding; phase checks IR-only) into compile-time types, proven by negatives.
- `prescribed()` reads beside `performed()` so conditions compare done-vs-stamped without re-deriving.
- The CompileRefusal taxonomy as the MCP error channel (machine-checkable, with the overBudget refusal naming its one fix).

From sonnet:
- The dual checking strategy: the TS embedding for hand-written programs AND a runnable `infer`/`check` over the JSON IR implementing the same rules, because the coach authors JSON, not TypeScript. Sonnet's implemented checker slice and `cost` are the starting code.
- `open`-field issuance plus append-only Resolution facts for APRE live resolution (fits the base's L6 immutability law exactly).
- `allocate` takes a literal `max` bound (fixes the base's data-dependent iteration count, the judge's only totality-adjacent flag).
- `StateDecl.writableBy` declared on state and checked statically (makes the base's single-writer law L3 a declaration, not only a check).
- The negative suite style under `exactOptionalPropertyTypes`, and `writeSet`/`whenWritten` in the analysis surface.
- Optionally the closed `SchemeComb` transformer combinators if "a phase is a function from a scheme to a scheme" must be literal; the base's `Use` partial application covers the worked cases.

## Rejected

- Fable's Canon normal form as the prose mechanism: elegant and theorem-shaped, but it shipped unimplemented, has no table former (schedule values undescribable), and its own free-text why/noun fields undercut the "derived, not asserted" claim. Its named() + budget survive as graft 2; the normal form itself loses to describer-tables-plus-traces, which exist and run.
- Fable's thin unit story (units asserted at reference sites, effects unchecked) in favor of the base's dimension vectors.
- Sonnet's per-muscle allocation writing slot state under writableBy: the judge showed the forEachMuscle instances collide on one key and a two-muscle slot is undefined. The base's program.extra ownership stands.
- Author-written transition reasons anywhere in the language.

## Known weaknesses accepted (from the judge, kept visible)

- An intent template can still misdescribe its body between example points; defenses are examples, the mechanism zoom, and the author's-wording marker. The library's templates are reviewed code.
- The TS embedding and the IR checker duplicate the typing rules (two implementations to keep aligned); the negative suites on both sides are the contract.
- "When does the TM change" has a static answer (writers: events and branches) and a projection answer, never a closed form.
- check/evaluate/step/prescribe are signatures with laws; implementation is the next phase, with every FnDef example and SchemeDef projection example as the seed test suite.

## What this supersedes

This round supersedes the round-1 synthesis (scratchpad/arena/synthesis-note.md) as the target design. Round 1's compat-driven choices (the preserved DerivedSet seam, legacy twins, the shadow-migration gating) are no longer design constraints. The round-1 laws that survive are restated in the brief and carried in the base: ledger-caused idempotent state, immutable issued facts, typed silence, the dose law, immutable versioned defs. The old implementation plan (scratchpad/implementation-plan.md) is superseded for phases P1+ and needs a re-plan against this algebra; what survives conceptually is scaffold-first sequencing, the review/merge laws, and the owner's five open questions where still applicable.

## Open questions for the owner (new, from this round)

Q1. The live Volume Cut program: with compat dropped, the new system can IMPORT it (compile old config to the new algebra, seed state so the next session matches) without the old engine surviving as a gate. Is "import with a one-time parity check, then the old engine is deleted" acceptable, or do you want the round-1 shadow window anyway?
Q2. Should user-authored (non-library) definitions be allowed custom intent templates at all, or generated prose only until promoted to the library?
Q3. Allocation default for your own program: commit or propose (the recorded owner-confirm rule for back-offs suggests propose)?
Q4. A late-logged session applies when it arrives (ingestion order) rather than restating later transitions. Acceptable?
Q5. Budget calibration and the `div` former: keep division out of v1 (nothing in the six programs needs it)?

## Next step

Amend the base files with the grafts (capability phantom, named/budget via the cost checker, writableBy, literal allocate bound, open-field issuance, prescribed reads, sort-derived binder names, table-data prose), port sonnet's checker/describer slices onto the base IR, and re-run the three verification suites. That amended package is the algebra handed to implementation planning.
