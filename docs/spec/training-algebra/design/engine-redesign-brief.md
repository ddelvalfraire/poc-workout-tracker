# Design brief: declarative programming & progression engine (total replacement)

Repo: /Users/daviddelval/code/github.com/ddelvalfraire/poc-workout-tracker (Next.js + Drizzle/Postgres workout tracker, live prod data, owner is the sole heavy user and runs a live 20-week program on the current engine).

## User intent (verbatim gist)

Programs and progression defined declaratively. Schemas reusable program→program, program→exercise, program→set. Capture intent ("add 2.5kg when all sets hit", "top set @RPE8 then −10% backoffs") with max reusability, "almost like a graph". This should enable a better programming UI and better user-facing program descriptions. Total replacement of the existing engine, not incremental patching.

## Current state (mapped, file:line refs available)

- One engine seam: `deriveDayPrescription` (src/db/prescriptions.ts:276) → pure `deriveWeekSets` (src/lib/programs/progression.ts:554) → autoregulate (src/lib/programs/autoregulate.ts, 1664 lines) → week overrides. Precedence: override > deload > scheme > template. Instantiation (`instantiateProgramDay`, prescriptions.ts:556) snapshots `prescribed*` columns onto logged sets.
- Config is already data: `progressionSchema` — a 7-way Zod discriminated union on `scheme` (linear, double-progression, percent-1rm, rpe-target, weekly-volume, rep-progression, amrap-cycle) stored as JSONB on program_exercises. deloadPolicy / overshootPolicy / autoregStallPolicy / dietPhase / planSync are separate one-off columns on `programs`, each with its own resolver and legacy-null meaning.
- But the engine is imperative: `scheme ===` branches in ≥13 files; "does this scheme carry a TM" written 8 separate ways; adding a scheme touches ~10 files.
- Set target columns (repMin, repMax, rir, rpe, suggestedLoadKg, tempo, durationSec, distanceM, restSec, technique) hand-listed in ~30 files (schema, overrides, applyOverride, copyProgramTree, patch ops, MCP tools, draft types, editor views).
- Progression state has NO owner: it is template rows + recomputed history + plan-sync writing performed loads back into `program_sets.suggestedLoadKg`. "Current working weight" exists nowhere as a fact. Linear adds weight per week unconditionally when autoregulation is off; the UI copy claims performance gating that the engine doesn't do. The 4 confirmed copy/engine contradictions: (1) linear's sentence says "complete all sets → +X next session" while the engine adds per week unconditionally when autoregulation is off; (2) amrap-cycle's sentence says "beat your rep record to earn the TM bump" while the engine bumps unconditionally once per completed wave; (3) percent-1rm's subtitle says the TM "bumps a small fixed amount each cycle" while the scheme has no increment field; (4) rep-progression's copy says "each session" while the engine bumps per non-deload week.
- No tables for weeks/blocks/TMs/progression-state. A "block" is a cloned program; TM is a field inside the progression JSONB; amrap bookkeeping (bankedWaves, tmBumpTiming) lives inside user-editable config data.
- Relative intent is inexpressible: no "backoff = top set − 10%", no derived loads from another set, no shared scheme reused across exercises/programs (templates are imperative TS helper functions in template-canon.ts).
- Overrides are positional per-week copies of the same column list; can't express "week 3: +1 set".
- Authoring: builder UI cannot author progressions at all (only TM); MCP tools + coach can. A set-scheme string DSL exists ("3x8-12 @ 7RPE", parseSetScheme) with no UI consumer.
- Tests: big pure-engine suite incl. property-based invariant registry (src/lib/testing/invariants.ts), golden corpus citing published canon (corpus.test.ts), 144-case autoregulate suite, 1664-line patch-op integration suite. These pin current behavior.

## Hard constraints (recorded project decisions — must survive the redesign)

1. Prescriptions are snapshotted facts. Once a session is instantiated, its prescribed targets are immutable history; never re-derive past prescriptions. (autoreg + provenance decisions)
2. Silence over corruption: when derivation can't be computed confidently, show nothing rather than a wrong number.
3. Ghost/Prev separation: input ghosts = plan targets only; Prev chip = history only; never mixed.
4. Deload: tmBumpTiming-style stamps — policy applied is stamped at the time, never re-derived later. Migrate-before-deploy law for DB changes.
5. Technique dose rules: one intensifier per exercise on the final set; scheduled deload strips it.
6. sets.weight semantics vary by logging_type; scoring only via effectiveLoadKg/bestScoredSet.
7. Live prod DB; owner runs a live program mid-block. Migration must carry his active program + history without corruption. Blocks = one 6-wk program entity per block (restart at boundaries) is the current model; redesign may replace it but must migrate it.
8. Coach/MCP program tools are a first-class authoring client; patch proposals with owner-confirm (db-layer forced) must keep working.

## What the new design must deliver

1. A declarative core model where a progression/scheme/policy is DATA defined once and referenced from any level (program, exercise-slot, set) — composition/inheritance across levels ("graph-like"). Reusable named schemes (e.g. "5/3/1 wave", "double progression 8–12 +2.5kg", "top set + 2 backoffs @ −10%") usable across programs and exercises.
2. Progression state as an owned fact (per exercise-slot working weight / TM / wave position), advanced by explicit, auditable transitions — not recomputed from history each read, and not written back into template rows.
3. Relative/derived expressions: sets derived from a TM, an e1RM, or another set in the same day (percent, delta, RPE-table).
4. An interpreter/evaluator that replaces the per-scheme switches: one registry/semantics so adding a scheme = adding data + one evaluator entry, and copy/descriptions are GENERATED from the same definition (fixing the copy-drift class of bugs forever).
5. Clean seams so the existing consumers of `DerivedSet`/`ExercisePrescription` (logger ghosts, program overview, preview tools, planned-volume) can be re-pointed.
6. A migration story: compile the 7 existing scheme configs + templates + live user program into the new model.
7. Room for the authoring UI and user-facing descriptions to be driven from the model (schema→form, definition→sentence), though UI build-out is a later phase.

## Explicit non-goals for the core design round

- Pixel-level UI design of the builder.
- Changing autoregulation SCIENCE (stall rules, fractions) — its structure may be re-homed, its decisions stay.
- Multi-user/marketplace features.

## Design tensions to resolve (the actual hard calls)

- How graph-like is too graph-like: full node/edge reuse graph vs. named reusable definitions with reference-by-id vs. structural composition (mixins/layers). Where does reuse stop earning its complexity for a single-owner app?
- State ownership: event-sourced progression ledger vs. a mutable progression_state table + program_events audit vs. keep deriving from history. (Constraint 1 and 4 bias toward explicit stamped state.)
- Expression power: a tiny closed expression language (percent/delta/clamp/round refs) vs. pure static JSON parameters vs. arbitrary code. Who evaluates it, how is it validated, how does it stay describable in generated prose?
- Where autoregulation plugs in: as a scheme-declared policy (data) vs. the current hardcoded per-scheme mode switch.
- Storage: normalized tables for definitions vs. JSONB documents with Zod parsing at the boundary (current pattern) vs. hybrid.
- Big-bang replace vs. compile-old-to-new (old configs become expressions in the new model, engine deleted in one wave per migrate-callers-then-delete).
