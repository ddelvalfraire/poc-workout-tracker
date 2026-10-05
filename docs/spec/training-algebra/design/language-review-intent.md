# Interrogation frame: the consolidated language itself (grammar, logic, semantics)

## Intent

The v2 package (post-fold, scratchpad/arena2/synthesis/) is a complete small language: a unit-and-capability-typed, total, first-order expression calculus; declaration sorts (metrics, facts, frequency, policies, state with kinds); a machine layer (plans, rules, triggers, outcomes); two clocks; an event/ledger semantics; and a prose semantics (describers + budget). This review interrogates the LANGUAGE QUA LANGUAGE, not the training domain: its grammar (is the term/declaration split principled; are the formers orthogonal or overlapping; what is the minimal core vs sugar), its logic (typing judgments sound and complete enough; capability lattice coherent; totality argument airtight; silence/3-valued semantics consistent across operators; the two-clock separation), and its reasoning/explanation semantics (traces, budget, generated prose as a semantics of its own). The deliverable includes a seated comparison against the best-matched established languages, in complexity and abstraction, with honest placement.

## Comparison seats (reviewers must engage at least these; add better matches if found)

- SQL / relational algebra: closed algebra under a surface, EXPLAIN as trace analog, totality via finite relations, the role of normalization. Where our aggregation/allocation sits vs GROUP BY and window functions; why no joins is fine or limiting.
- Datalog (stratified): recursion-free fixpoints, stratification vs our level/publication ordering, negation-as-silence comparison.
- CEL / Starlark: industrial total languages; CEL's non-Turing-completeness and cost limits vs our budget; Starlark's determinism and no-recursion discipline.
- Lustre / synchronous dataflow (and statecharts): clocks as types, streams vs our event-fold; whether our two-clock design matches clock calculi; Mealy machines at every scope vs Harel statecharts (hierarchy, orthogonal regions we deliberately lack).
- F# units of measure / dimensional type systems: our DimVec vs principled unit inference; where we fall short (literals, derived display).
- Timed automata (UPPAAL) for the time model: guards/invariants vs our frequency constraints and gap reads; what we cannot verify that they can.
- Rules engines (Drools/production systems) and event sourcing/CQRS: our pre-state rule semantics and declaration-order effects vs RETE conflict resolution; ledger/fold vs ES projections; idempotent cause keys vs ES dedup.
- Spreadsheet/Excel formula model: the authoring-accessibility bar; what Excel teaches about non-programmer authored total languages.

## Specific pressure points for the rubric

1. Grammar economy: 52+ formers, 4+ declaration sorts, policy/frequency/calendar/lifecycle constructs. Is there a smaller orthogonal core (e.g., are schedules, tables, bands, recent-windows all one indexed-lookup concept? are gates/policies/roles one conditional-transformer concept?) or is each earning its place? Identify merge candidates and missing orthogonality.
2. Semantics gaps: is evaluation order fully specified everywhere (agg element order, allocation determinism, policy application order vs rules, two policies matching at once)? Is the silence algebra (Opt + unknown bounds + stale facts) actually one consistent 3-valued logic or several ad-hoc ones?
3. Type system soundness: capability subtyping + unit vectors + kinds; any hole where TS embedding and IR checker disagree becomes an authoring trap; is the budget a type, an effect, or a lint, and is that choice coherent?
4. Expressiveness class: what is the formal power (first-order, primitive-recursive over finite data)? What common training idiom is OUTSIDE it that we have not yet named? Adversarially construct programs the language accepts but humans would consider wrong (describable-but-silly is accepted by design; find describable-but-MISLEADING).
5. The prose semantics: can generated prose and evaluation semantics diverge anywhere (schedule overflow phrasing, policy stacking, silence reasons through named boundaries)? Is prose a FUNCTION of the term everywhere, including policies and frequency?
6. Authoring ergonomics vs SQL's bar: can a coach/LLM write this with only the checker's errors as a tutor; are refusal messages a teaching grammar; where would an author reach for a loop/join and find nothing?
7. Honest placement: on complexity and abstraction, is this closer to SQL (big win), to HCL+CEL hybrids (fine), or drifting toward a bespoke Lustre-with-prose (risk)? What should be CUT before v1 to keep it learnable?

## Mechanics (when fired)

Three reviewers (interrogate line: opus, fable, sonnet), readonly, each gets this intent + the standard rubric + code-quality lens, reads the v2 package end to end plus rationale and time-model.md, and may WebSearch for language-design comparisons. Each must deliver: findings per the severity format, the comparison table (our construct vs each seat's analog vs verdict), the merge/cut list, and the misleading-program constructions. Lead judgment synthesizes; the verdict feeds the re-plan (what to simplify before implementation starts).
