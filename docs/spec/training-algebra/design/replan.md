# Delivery re-plan: the training algebra to production

Supersedes the round-1 implementation plan entirely. Rigor stays high: live prod data, the owner's live program, review-before-merge AND owner approval on every merge, deploys manual, migrate-before-deploy for every schema change. Each phase is a stack of reviewable PRs near the 300-line guideline; the phase is the unit of verification, the PR the unit of review.

Definition of done for the whole effort: the algebra (v3 grammar) runs the app's programs end to end in production; the six worked families (strength canon, hypertrophy incl. RP, cardio, PT gates, frequency/adherence, techniques) are library definitions; every number the UI shows carries generated prose and a trace; the old engine is deleted; the live Volume Cut block was imported with a zero-unadjudicated-diff parity report; the 238-class test plan is fully dispositioned (covered, re-homed, or explicitly waived with reason).

## R1. Simplification fold (v3) — IN FLIGHT
The interrogation's Act-On list applied to the sketch package (simplification-spec.md): three-valued verdicts, one patch outcome, policy hit-policy + composed prose, one table former, iterate/both cut, IR as single authority with the clock-sort/xform/ladder closures, derived StateKind, prose honesty round, calendar fixes, range(n).
Gate: verify.sh green; the misleading constructions from the review become refusals or inexpressible; construct count net-reduced.

## R2. Evaluator and conformance (still sketch-side, scratchpad)
evaluate/step/prescribe/resolveLive/project implemented pure; FnDef examples and SchemeExamples run at publication (exampleFailed live); prose-vs-trace differential over the whole worked corpus; the 39 SPEC? rows from the test plan resolved as law decisions (empty-session, calendar catch-up, proposal staleness already ratified; the rest decided and recorded); property tests for L1-L13 (replay, idempotency, commutation, silence). Deferred Consider items decided here with the evaluator as evidence: unified read former, allocate-as-fold.
Gate: every EC/BV class dispositioned against the running semantics; zero prose/eval divergence on the corpus.

## R3. Repo scaffold (first repo code; stacked PRs begin)
Package lands in the repo (src/lib/algebra/ or similar; final name at PR time) with vitest ports of verify.sh, the negative suites as type-tests, CI wiring, and the lint ratchet (no scheme=== outside the registry; no imports from the old engine into the new package). Design docs land under docs/design/engine/ with the decision trail. This is the first owner-reviewed merge.

## R4. Persistence shell
Drizzle tables: defs (id, version, hash, body), ledger (owner, causeKey unique, transition), heads (CAS on seq), issued sessions + stamps, expectations/adherence (+ workouts.local_day). Expand-only migrations, each deployed inert before the code that reads it. IO shell functions (load, persist, reconcile) with Postgres-level idempotency tests (concurrent start, crash replay, late ingestion).

## R5. Importer and parity (the lever)
compileLegacy: every stored program + template canon + the live block → defs/bindings/seeded state + migration transitions. The parity tool dual-runs old deriveWeekSets vs new prescribe for every remaining week of every active program AND projection-replays boundaries (deload, cycle end, block restart). Per-slot report; unaddressable slots stay on the old path and are listed, never guessed (silence over corruption).
Gate: zero unadjudicated diffs on the live Volume Cut block; owner reads the report (D1).

## R6. Cutover and deletion
Consumers re-pointed in one wave: logger ghosts/plan targets, program detail + overview prose (from describers), planned volume, MCP read tools, editor derive calls. Old engine code (progression.ts, autoregulate routing, plan-sync write-back, tm-restart, scheme-copy switch, autoregPlan) deleted in the same wave. Old tables flip read-only; drop one release later after pg_dump (D14). Manual prod deploy after approval; the live block trains on the new engine from here.

## R7. Authoring and adherence surfaces
MCP: def/bind/edit tools with registry-generated schemas, refusal-channel errors, proposal flow with describeDiff. UI: scheme picker + generated param forms in the builder, program-page prose from describeProgram, ledger timeline ("why didn't my weight go up"), due verdict + adherence on home (within home-status design laws: no new home queries beyond the brain's budget), check-in inputs (pain, readiness) behind the gesture-driven prompt rules. Each sub-surface its own PR stack with stories per component law.

## R8. Deferred by decision (revisit on evidence)
Text surface (Peggy printer/parser), windows/rings beyond cal.recent, regimen scope (concurrent programs), VBT reducers + per-rep facts, live session caps, macro peakOn backward scheduling, dim-polymorphic user fns.

Sequencing laws: R1→R2 strictly (grammar freezes before the evaluator targets it); R3 after R2 (only verified language enters the repo); R4/R5 may interleave as stacks but R5's gate blocks R6; R7 follows R6 so surfaces never target two engines. Throughput checkpoint: the long pole is R2 (evaluator + 238 dispositions) and R5 (parity); everything else is bounded mechanical work.

## Addendum (2026-10-04, after the closing trail review)

The Rust ruling superseded R3-R7's delivery vehicle, NOT these obligations, which carry into the composed N-phases:
- The live Volume Cut import with its parity gate (zero unadjudicated diffs, owner reads the report) and the projected boundary replays: now part of N3.
- Old-engine deletion and old-table retirement with backup (D14): N3.
- The waived/carried disposition rows: EC-212 (canonical hashing) is a SEAM PREREQUISITE (N2), not deferred; EC-198/204/210/211 re-home to the surfaces phase of N3.
- The full open-items checklist for the Rust room and the seam lives in seam-open-items.md and is normative for N1/N2.
