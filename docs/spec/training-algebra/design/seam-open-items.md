# Open items the Rust room and the seam MUST resolve (from the closing trail review, 2026-10-04)

> UPDATE, later 2026-10-04 (ratification round, verified): items 7, 8, 9 are RESOLVED in the oracle and kit. 7: laws owner-ratified with three owner-directed changes (proposal acceptance re-checks writability against proposer-or-owner; RP allocation is truly weekly via the once-a-week-per-extras-slot rule; ONE quantization law, ties round down everywhere). 8: the sink/round formulation is pinned portably in SPEC 6.1 (decimal-scaled, Q=10^9, exact-integer final step). 9: the RP fixtures now carry correct weekly numbers (16 → 12 in the proving case). Items 1-6 and 10-12 stand.

The conformance kit proves the oracle is deterministic and the kit intact. It does not prove the oracle's answers are right, and it is silent on the seam. These items are load-bearing; none is optional.

## Seam semantics (decide before the crate API freezes)
1. **Amended workouts.** The data core reopens and re-seals a workout as version n+1. The algebra has only sessionClosed with an idempotent causeKey. Same causeKey = corrections never reach progression; new causeKey = progress clock advances twice. The seam needs an explicit amendment event (likely: supersede-and-refold from that point, or an amendment transition type) and the SPEC must carry it.
2. **Where step runs.** The crate ships to phones (UniFFI) and the server. prescribe writes dayClosed entries while reading; a phone and the server can race the same per-day causeKey with different fact snapshots, first-writer-wins, no error. Decide: server-authoritative folding (phones project only), or a merge rule. Server log order being the only ordering authority (the rewrite's own law) suggests server-authoritative.
3. **Catch-up bursts.** A long absence = N per-day ledger writes at once; Dynamo transactions cap items. The seam needs a batched/chunked catch-up contract.
4. **Definition identity (EC-212).** programHash and Resolution keys use a placeholder FNV over JS JSON.stringify, and conformance EXEMPTS hash fields. Rust and TS can disagree about identity silently. Real canonical-form hashing is a prerequisite of the seam, not a nice-to-have.
5. **Conformance format reconciliation.** This kit is recorded oracle calls; the data core's contract is golden event-log fixtures in the crate. Pick one carrier or a mapping.

## Oracle trust (before fixtures are treated as truth)
6. **Second adversarial read of SPEC sections 3-4** (evaluation, step, issuance, calendar). The typing half got that read and yielded 23 real bugs that the fixture corpus had NOT caught; the semantics half never did. Either run the same read, or adopt the standing rule: every Rust/oracle disagreement is adjudicated by a person and never settled by copying the oracle.
7. **Owner ratification of the delegate-made law decisions** (SPEC 6.1; ~35 beyond the four ratified). Athlete-visible ones to confirm or amend: sink rounds ties DOWN while `round` rounds ties up; accepting a proposal skips the writableBy re-check; newer proposal supersedes older on the same field; trainWeek counting rule; allMiss projection semantics; an increment finer than the grid stalls the prescription (bench 85, 85, 87.5 kg, touches the live program and the quantization law).
8. **Pin the sink's float operation order in SPEC.** g x ceil(x/g - 0.5 - 1e-9) can jump a plate step near ties if Rust reorders; fixtures' 1e-9 tolerance won't catch it.

## Known-wrong or missing behavior currently pinned by fixtures
9. **RP allocation hands out per-session sets against a weekly gap** (recorded bug; fixtures pin the wrong numbers). Fix in oracle + regenerate before Rust implements allocation, or mark those fixtures advisory.
10. **phaseAdvance/confirmFloor is unimplemented** though the ratified clinician-gate default depends on it; floorNotConfirmed has no fixture. Implement at the seam (it needs an owner event) and fixture it.
11. **Issued sessions do not carry the day's group shape** (superset/circuit/EMOM structure); the logger needs it. Add to the issued fact before surfaces build.

## Prose and locale
12. **Decide where prose generates before porting describers.** 442 fixtures pin exact en-GB sentences; the i18n law requires per-user locales. Options: describers stay message-descriptor-shaped (keys+values) with locale catalogs (matches the app's existing i18n), and the prose fixtures compare descriptors, not strings. Do not port fixed English strings into Rust.

Owner-ratified context lives in decisions-memo.md and the memories; this file is referenced from memory/training-algebra-language.md.
