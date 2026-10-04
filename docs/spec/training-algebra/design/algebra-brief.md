# Design brief: the training-program algebra (fresh look, no legacy constraints)

## The ask (owner, verbatim gist)

"Don't worry about backwards compat or existing tools. Fresh look into what's possible. Making a typed programming language is optimal. Design the algebra for our language. If it makes the engine simpler and makes it easier to create complex programs with granularity, it's worth it. Storage of schemes and the algebra can be separate; we can have both without coupling the storage/engine layer to the language."

This supersedes the earlier engine-design brief's compatibility constraints. The earlier synthesis (scratchpad/arena/synthesis-note.md + candidate-opus/) is PRIOR ART to learn from, not a base to preserve. Steal what was right, discard what was compat-driven.

## What this round must produce

The FORMAL CORE of a typed, total, declarative language for training programs and progressions. Not a parser, not storage, not UI. The algebra: sorts/types, terms, typing rules (sketch-level), evaluation semantics, state-transition semantics, composition/reuse semantics, and the describability mechanism. TypeScript is the host for the sketch (types + evaluator signatures), but the deliverable is the language design, independent of storage (documents, tables, text syntax all compile to/from it later).

## Evidence from this run (binding inputs)

1. **The expressiveness stress test** (summarized in the session; key findings):
   - A slot-scoped language covers per-exercise progression well but CANNOT say: per-muscle-group volume aggregation and allocation (RP's core), progressions that change the exercise (NASM proprioceptive ladders, conjugate rotation), cross-program/macrocycle sequencing (OPT phases, block periodization), pre-session feedback gates (soreness/readiness), intra-session derivation (APRE set 4 from set 3), round/time-domain structures (EMOM).
   - Highest-leverage small additions found: state-comparison conditions (counters/streaks), effort conditions over logged RIR/RPE, bodyweight and peer-e1RM load sources, per-rep effects.
2. **The DSL research** (cited in the session):
   - The declarative power of SQL is its closed algebra; text is a replaceable surface. Store the IR, print canonically, parse one-way.
   - Liftoscript's lesson: imperative scripting over mutable state with an escape hatch required two redesigns; named, parameterized, analyzable intents win.
   - Generic expression cores (CEL, JSON Logic) lose describability; domain intents must stay first-class.
3. **The first arena's convergent findings that remain right regardless of compat**: owned state advanced only by explicit transitions with idempotent causes; definitions as immutable versioned values; evaluation is total; silence over corruption (unresolvable = typed absence, never a guess); every construct must be renderable to human prose AND to an authoring form; the one-intensifier technique dose law; prescriptions, once issued, are immutable facts.

## The central tension to resolve (this is the design problem)

The owner says "a typed programming language is optimal". The prior law says "every term must generate honest prose". The last round resolved this with a closed, arithmetic-free intent language, and the stress test showed exactly where that runs out of road (aggregation, allocation, cross-scope reads, computed increments). This round must find the sweet spot: HOW MUCH computational power can the algebra admit while keeping
- totality (terminates, no unbounded recursion),
- static typing with DOMAIN UNITS (kg, lb, reps, RIR, RPE, %, seconds, meters, sets, week-index; unit errors are type errors),
- analyzability (the engine can answer "what does week 7 look like" and "when does the TM change" without running workouts),
- describability (prose from terms; the design must say precisely how prose survives richer expressions: fold-with-describers per node, intent annotations on expressions, normalization to a describable canonical form, or an explicit two-layer split of describable intents over a typed expression core),
- LLM/MCP authorability (typed schema, constrained decoding, machine-checkable errors).

Candidates should take DIFFERENT positions on this dial. That is the point of the arena.

## Scope requirements (from the stress test; the new algebra must address each EXPLICITLY)

Design the scope/binding structure so these are first-class, or argue explicitly why one stays out:
- **Set scope**: a set's targets, relative references to earlier sets (and the APRE question: references to PERFORMED earlier sets within the session).
- **Slot/exercise scope**: owned state, per-session and calendar transitions. Exercise identity: can a progression swap the movement (typed exercise values / variant ladders)? What does that do to history continuity?
- **Day/session scope**: supersets, rest structure, EMOM/time-domain shapes (in or out, say why).
- **Muscle/aggregate scope**: typed aggregation over collections ("weekly chest sets across all slots"), and ALLOCATION (add a set to the best candidate slot). This is RP. If admitted, show the typing and the prose story; if constrained (e.g., aggregation readable everywhere, allocation only via proposals), justify.
- **Program/mesocycle scope**: calendar with week roles beyond train/deload (test, taper, phase labels), policies as values.
- **Macrocycle scope**: phase sequencing (OPT: stabilization → strength → power), state handoff between blocks, peaking to a date. In or out, say why.
- **Inputs**: typed, declared external facts (e1RM, bodyweight, logged RIR/RPE, and FUTURE ones: soreness, readiness, velocity). Inputs are declared per definition, stamped when used; the algebra should make adding an input a type-level event, not a redesign.

## Non-negotiable laws (carried forward)

- Total evaluation; no user-defined general recursion; no escape hatch to arbitrary code.
- Every type carries a unit; ill-unit terms don't typecheck.
- State changes only via transitions with causes; idempotent under replay; auditable.
- Issued prescriptions are immutable facts; derivation never mutates.
- Unresolvable values are typed absence (silence), never defaults.
- Every term must have a prose rendering and a form rendering; the design states the MECHANISM that guarantees this for all expressible programs (not just the easy ones).
- Definitions are immutable versioned values; reuse is by reference + arguments (composition semantics must be spelled out: blocks/schemes/programs, parameterization, and whether higher-order composition such as "a phase is a function from a scheme to a scheme" is admitted).

## Explicitly NOT constraints this round

- The current DB schema, tables, column names, seams (deriveDayPrescription etc.).
- Migration of existing data or the live program (a fresh system may import, but design the algebra first).
- The current autoregulate.ts implementation (its SCIENCE/decisions may be re-expressed as algebra terms or declared policies; keeping its code is not required).
- The 7 legacy scheme names.

## Deliverable per candidate

1. The algebra: sorts, term formers, typing judgments (informal but precise), evaluation + transition semantics, composition semantics. In a .ts sketch (types + signatures + laws as comments) plus a rationale per the architect template.
2. The describability mechanism, demonstrated on a HARD case (e.g., RP allocation or a computed Juggernaut increment), not a toy.
3. Worked programs in the algebra: (a) gated linear, (b) top set + backoffs with APRE-style same-session adjustment, (c) full 5/3/1 including BBB at 50% of the squat TM, (d) GZCLP T1 with stage resets, (e) an RP hypertrophy mesocycle with per-muscle weekly volume targets and feedback-driven set additions, (f) a NASM OPT macrocycle sketch (phases with tempo changes and exercise-variant ladders).
4. The decoupling story: algebra as IR; how documents/tables/text/forms all compile to/from it; where the engine sits.
5. What got SIMPLER relative to the first-arena design, and what got more powerful; honest cost accounting.
