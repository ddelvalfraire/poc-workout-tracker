# Open decisions: recommendations, pros and cons, alternatives

Every open product call accumulated across the design run. Each entry: the decision, my recommendation, why, the strongest alternative and its cost. Recommendations become the amendment round's working defaults; any can be overridden by the owner in plain words.

## D1. Live Volume Cut program: import vs shadow window

**Recommendation: import with a one-time parity check, then delete the old engine.**
- For: you removed the compat constraint; the import compiles your program into the algebra and seeds state so the NEXT session's numbers match the old engine's, verified once by a script, not argued. The shadow window's remaining value was catching multi-week fold divergence, and the new engine's test plan covers those paths directly (238 classes, projection tests), which is a stronger instrument than weeks of waiting.
- Against: a one-time check cannot catch a divergence that only appears at a future boundary (your week-6 deload, block restart). Mitigation: the import script also dual-runs the remaining block weeks under projection and diffs them, which recovers most of the shadow's value at zero calendar cost.
- Alternative: the round-1 shadow release (serve old, log mismatches across your real sessions). Cost: weeks of wall-clock, dual engines maintained, and it only exercises the paths you happen to train.

## D2. Missed expected session: progression miss or adherence fact

**Recommendation (provisional until the time memo lands): adherence fact only, never a progression miss by default.**
- For: progression gates judge performance against issued prescriptions (snapshot facts). A session that never happened issued nothing, so treating absence as failure invents evidence, which violates silence-over-corruption. Mentzer-style and PT programs that DO want absence to matter can say so explicitly in their rules once time is first-class ("if 14 days since last session, restart at 90%").
- Against: linear programs implicitly assume weekly cadence; a user who skips a month and returns "on week 9" gets stale-feeling numbers. Mitigation: the detraining gate is a library policy, opt-in per program, not an engine default.
- Alternative: missed-counts-as-miss by default. Cost: GZCLP drops stages on vacations; rejected by three reviewers' logic on empty sessions.

## D3. Empty-session close (finished with zero logged sets)

**Recommendation: a typed non-event. Refused at ingest as a progression cause; recorded only as an adherence fact.**
- For: this is your shipped empty-finish law carried into the new engine as a SPEC rule instead of a guard. No rule fires, no streak moves, nothing is "hit" or "missed".
- Against: a user who genuinely attempted and failed everything logs nothing and gets no stall credit. Mitigation: logging an attempted set with zero completed reps is the honest encoding of that case and works today.
- Alternative: empty close counts as a full miss. Cost: the test plan showed linear proposes deloads and GZCLP drops stages on phantom sessions.

## D4. Allocation on your own program: commit or propose

**Recommendation: propose, as the program-level default, with commit available per program.**
- For: matches your recorded owner-confirm law for anything that changes your plan without you (back-offs during a cut, patch proposals). RP-style volume moves are exactly the class of silent change you have historically wanted to confirm. The policy former makes this one declaration.
- Against: weekly confirmations add friction for a mechanism whose whole point is autoregulation. Mitigation: additions can auto-commit while reductions propose, expressible once outcome policies exist; or flip your own program to commit after a block of trust.
- Alternative: commit silently with a visible ledger entry. Cost: first surprise set-count change erodes trust in the whole engine.

## D5. Custom prose templates on user-authored definitions

**Recommendation: generated prose only for non-library definitions; custom templates unlock on promotion to the library.**
- For: the template is the one place an author can make copy lie about behavior; the guards (hole coverage, evaluated examples) narrow but don't close it. Library promotion is a review moment where curated wording is justified. Generated prose after the budget discipline is already readable (measured on the RP and Juggernaut outputs).
- Against: your own defs read slightly clunkier until promoted. Mitigation: the "author's wording" marker alternative exists if this chafes.
- Alternative: allow custom templates everywhere with the marker. Cost: reintroduces copy-drift surface in the place with least review.

## D6. Back-off durability

**Resolved by the round-2 design; no decision left.** In the algebra, a back-off is a state transition (commit or propose) in the ledger, so it is durable and auditable by construction; the round-1 "per-read verdict" world no longer exists. The cut-mode law rides D4's outcome policy.

## D7. Cross-slot reads in v1

**Resolved by design: in.** peerState is core (BBB at 50% of the squat TM is a worked program). The restart key-remap cost round 1 worried about disappears because exports/seed channels address runs, not slot-row ids.

## D8. New-program linear default

**Recommendation: performance-gated linear is the library default; the import maps your existing slots to whatever they actually did (weekly, unconditional).**
- For: new programs should mean what the sentence says; the import must not silently change your live behavior.
- Alternative: weekly default everywhere. Cost: re-ships the copy/engine contradiction the redesign exists to kill.

## D9. Late-logged sessions

**Recommendation: ingestion order stands. A session logged days late applies when it arrives and never rewrites transitions that landed after it.**
- For: replay determinism and issued-facts immutability; retroactive reordering would re-derive history, breaking the provenance law.
- Against: a late-logged great session won't retroactively earn the bump it "deserved". Mitigation: the next session's rules see the state as it now is; one session of lag in a progression is noise.
- Alternative: retroactive replay with ledger rewrite. Cost: unreproducible audit trail; rejected.

## D10. Budget calibration and division

**Recommendation: lock budget 4 and ship v1 without div; revisit only on evidence from ten real authored programs.**
- For: measured on the worked corpus, only one expression needed naming at 4; nothing in 116 programs needed division (pace becomes a unit, ratios come from ratioOf-style formers).
- Alternative: budget 5 or div now. Cost: weaker naming pressure, prose quality drops at the margin for no demonstrated need.

## D11. Rest-pause and myo-reps encoding (the duality the corpus found)

**Recommendation: intensifier technique is canonical for dose-law and volume counting; a new event read exposes stage outcomes to rules.**
- For: keeps the one-intensifier dose law structural and volume counting correct (a rest-pause set counts once), while DC-style "sum of mini-set reps" rules get their data through an EventQuery over stages rather than by exploding sets into steps.
- Against: one more event former. Alternative: bless the telescope-steps encoding. Cost: volume counts a rest-pause set as three sets and deloads can't strip it; rejected.

## D12. ACL-style bounded phases at max weeks

**Recommendation: `atMax: propose` becomes the DEFAULT for bounded phases whose advance condition is criteria-based; plain time-boxed phases keep advance.**
- For: a rehab phase that advances a failing knee on a timer is the single worst silent behavior the corpus found. Proposing at max surfaces the call to the human, which is what a clinician does.
- Alternative: always advance (status quo). Cost: times patients into sport; rejected for criteria-gated phases.

## D13. Session-level caps (cardiac rehab HR/Borg ceilings)

**Recommendation: defer the construct; ship caps as plan-level constraints rendered in prose, not as live session enforcement.**
- For: live enforcement is a device/logger concern (the reviewers' unanimous boundary), and v1 has no in-session engine loop beyond APRE resolution. The prescription can carry "keep HR under 120" as a described constraint today.
- Alternative: a first-class SessionCap with logger integration. Cost: new runtime surface in v1 for one protocol family; defer until cardio ships and the logger grows HR display.

## D14. Old engine and tables after import

**Recommendation: delete the old engine code at cutover; keep the old tables read-only for one release, then drop after a backup.**
- Unchanged from the round-1 plan's revised P7/P7b shape; the fresh-look only removes the shadow serving, not the prudence.

## D15. Velocity, HR traces, TSS-class models

**Recommendation: confirm the boundary split as policy: raw series and fitted models never enter the language; registered reducers emit declared scalar facts.**
- This is the unanimous three-reviewer and corpus verdict; recording it as a standing decision prevents relitigating per feature.

## Dependencies

The amendment round folds A-J with D2, D3, D4, D5, D8, D10, D11, D12 as working defaults. D1's import script and D14's retirement live in the implementation re-plan. The time memo may adjust D2's phrasing and adds its own open calls; reconcile on arrival.
