# Arena synthesis note: declarative engine redesign

## Base

Candidate opus ("typed scheme definitions, an owned state ledger, one interpreter"). Both the parent read and the cross-judge (opus model, independent read of all files plus repo verification) picked it. It is the only candidate whose four canonical intents are all correct as written, the only one that noticed full-replace saves re-mint program_exercises ids and added a durable slot_key, and its no-arithmetic intent language makes "copy cannot drift" hold by construction.

All three candidates converged on the same fundamental shape (closed rule language, node registry with evaluate+describe in one entry, immutable versioned defs, idempotent ledger-backed state, tmBumpTiming as transition timing, week patches over positional overrides, one target-field registry, declared autoreg routing untouched science, compile-legacy + dual-run gate, delete old engine in one wave). Per the arena protocol that convergence is the consensus shape and it ships.

## Grafts folded into the base

From fable:
1. Keep the public seam: `deriveDayPrescription` / `instantiateProgramDay` names and the `DerivedSet` field names (setType, metricMode, derivedFrom, schemeLoadKg). The prescribed|silent union stays, but field naming matches today so re-pointing ~15 consumer files is mechanical.
2. Plan-sync remains its own explicit audited transition (a `setState`/setAnchor cause with reason 'plan-sync'), NOT folded into regulation. planSync on/off stays independent of the autoregulation switch. (Fixes the base's planSync-coupling red flag.)
3. Relative set refs may only point to an EARLIER line (replaces topological sort; cycles impossible by construction).
4. `editable` flag on StateDecl so forms know which state the owner can edit directly.

From sonnet:
5. The in-production shadow release becomes the cutover gate: after backfill, instantiation computes both engines, serves legacy, logs mismatches to program_events across the owner's real sessions. The fixed-history shadow run is necessary but not sufficient (it cannot see fold/regulation behavior).
6. Unit-typed static check in compile (kg+reps nonsense rejected; every Expr/NumRef position carries a Unit).
7. `describeDiff(before, after)`: patch proposals render as generated sentences.
8. `project({assume: 'all-hit' | ...})` for future weeks, every result tagged `projected: true` (honest previews; the head never pretends to un-fold).
9. `WeekEdit` gains `weeks: number[] | 'all'` multi-week addressing.
10. Explicit def version upgrades with a preview diff (describeDiff between versions).
11. Migration backfill is a `--dry-run`-first script run from the main checkout (worktrees lack .env.local; DATABASE_URL is live prod).
12. Seeding policy as data: StateDecl.init already covers fromE1rm; the e1RM@3RIR*pct form is kept as the declarative spelling of the recorded baseline policy.

## Red-flag fixes applied to the base (from the cross-judge)

- Regulation verdicts do NOT persist as durable state in v1. Regulation stays a derive-time adjustment layered at prescribe (exactly today's precedence), routed by the declared `regulation` field. The ledger owns only scheme-rule state. Persisting verdicts was the base's one silent behavior change, it breaks the recorded cut rule (a 3-stall back-off during a cut must go through an owner-confirmed proposal), and the shadow run cannot detect it. Durable verdicts become an explicit later product decision.
- Legacy linear with autoregulation ON maps to `canon/linear-weekly` + fixed-mode regulation (today's actual behavior: weekly add with stall-repeat), not to the gated canon. The gated `canon/linear` is the default for NEW slots only.
- Schedules accept per-binding rows (a 'table' arg type) so percent-1rm slots bind the canon def instead of all becoming inline defs.
- Public surface trimmed: seedState, carryState, calendarEvents, weekPosition, pendingSteps become internal; the phantom PolicyDef mention is dropped (program policy is the materialized ProgramPolicies value).
- Past-week views: weeks with a stamped session render from the stamp; other past weeks render via project() with projected marking. The head never un-folds.

## Rejected

- Sonnet's ledger-row-as-state (no head): elegant, but the base's head+ledger written in one transaction with CAS plus a head=fold property test keeps O(1) reads and the same audit; sonnet's UNIQUE(slot_id, trigger_key) also collides when several rules fire on one trigger.
- Fable's programExerciseId-keyed state (orphaned by full-replace saves) and its no-catch-up week triggers (silent drift on skipped weeks). The base's slot_key + lazy calendarEvents catch-up stands.
- General arithmetic (sonnet's mul/add/clamp): the intent-level load language stays; describability wins.
- Full node/edge reuse graph: all three candidates and both judges rejected it for a single-owner app; reuse stops at depth-2 refs with args.

## Dropouts

None; all three runners delivered.

## Verification of the synthesis

The synthesized design satisfies the rubric by construction of the grafts: all four intents expressible (base, with GZCLP/5/3/1 verified correct by the judge against published canon), reuse at program/exercise/set levels (library defs + BlockDef + args), owned stamped idempotent state (ledger + slot_key), one definition driving evaluator/sentences/forms/MCP schemas, closed describable expressions, and a migration gated by fixed-history dual-run PLUS an in-production shadow release with zero unadjudicated diffs on the live program. Holding it to the figure-it-out predicate happens at implementation (the harness is Phase 1 of the plan).

## Open product questions (owner must answer; implementation can start on 1-3 regardless)

Q1. New-slot default for linear: performance-gated (`canon/linear`) with migrated slots staying weekly — recommended — or keep weekly everywhere?
Q2. Should regulation back-offs ever become durable ledger state (v2 question), or stay per-read forever?
Q3. program_sets / program_set_overrides: drop in the same wave (base plan) or keep one release as a derived read-model while the 1664-line patch-op suite re-targets?
Q4. Cross-slot reads (BBB at 50% of main lift TM): ship in v1 with restartBlock key remapping, or defer?
Q5. StrongLifts/GZCLP templates: switch to per-session progression at cutover or later?
