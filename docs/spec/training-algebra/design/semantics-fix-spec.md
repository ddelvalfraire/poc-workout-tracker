# Semantics fix spec (post three-reader adversarial review)

Union of reviewers A (semrev-a/), B (semrev-b/), C (semrev-c/); their probe scripts are the reproduction suite and BECOME regression tests. Where reviewers conflict, adjudicate by running the probes. Owner's standing directive governs every call: objectively correct per the existing laws, never what fits best. Decisions below are set accordingly; each is overridable by the owner only.

## Harness law first
H1. The conformance/test harness must accumulate resolutions across resolveLive calls (today it recomputes from [] each time, which is why C1-class bugs were invisible). Fix testkit, then port EVERY probe from semrev-a/b/c as named regression tests (failing-first against the frozen package where they demonstrate bugs).

## Criticals (fix, each with its probe as the failing-first test)
F1. nth/empty totality (B-C1 vs C's claim the checker refuses it): adjudicate with B's probe (agg slotsFor on a primary-less muscle). Result must be typed absence (emptyPick) through every consumer; no undefined Value can exist; SPEC 3.1 states it. Add the checker rule if reachability requires one.
F2. Open-field frames (A-C4, B-C2, C-W3): redesign capture to be binding-environment-correct. Reads under binders are captured with their bound values (key by canonical JSON of the CLOSED node); shadowing resolves to the correct binding; reads the live context cannot serve (fact/keys/agg/event) are either captured at issue or the checker refuses non-closed read keys inside live bounds. No checkable program may crash resolveLive. SPEC 3.2 rewritten.
F3. Revert staleness (A-C1, C-C1): resolution dedupe compares against the LATEST row per cell, not membership in all history; A→B→A writes a superseding row. Resolutions gain a seq; currentView orders by seq, never array position (also closes A's store-order warning).
F4. Intra-pass staleness (A-C2): resolveLive iterates to fixpoint within a pass (or re-reads the view per resolved row) so a field depending on a just-resolved open field resolves in the same ingestion. Bounded by the telescope's acyclicity.
F5. Repeat-block iteration (A-C3, C-C2): live resolution and readiness resolve step ids PER ITERATION (the current iteration's row), matching planning. B@0 resolves from A@0.
F6. e1rm absence (B-C3, A, C-C3). DECISION (objectively correct per L7): for logging types where load is the lifted load, a reps-bearing set with no load is SKIPPED by e1rm; if no set qualifies, the read is absent. The ?? 0 default remains only where 0 genuinely means zero added/assistance load (weighted/assisted bodyweight), stated per logging type in SPEC 3.3.
F7. Assisted direction (B-C4, C-W4): the performed former and live resolution flip best/worst for assisted loads exactly as the event path does; one shared implementation.
F8. Calendar ordering (A-C5, A-C6, C-W7, B-N5): lastOn and the lapse clock use max(localDay) ≤ today, never ingestion order; cal.gap cannot go negative (guard the fast path like the fallback); dayClosed gains a monotonic guard (a regressed or skipped day cannot un-close or orphan a window; reconcile closes through the max seen day).
F9. Completion guard (C-C4): skip (and every lifecycle/progress event) respects programComplete exactly as sessionClosed does; nothing advances the progress clock past blockEnd. L11/EC-161 test.
F10. Anchored drift (A-C9, C-C5): fix the week-close formula (true modulus; anchor day itself closes nothing before the program starts), define or refuse activatedOn < anchor, and make projection reconcile anchored weeks in the same order prescribe does (no over-issued sessions). 5/3/1 week-1 regression.
F11. Dimensioned edges (B-W3, A-C8, C): edgeOf and prescribed reads carry the metric's dimension and display unit; traces for prescribed-based math render in the metric's unit. The 7030% trace dies.
F12. scaleSets factor (A-C7, C-W5). DECISION: factors > 1 are refused at check (deloads shrink; growth is addSets). Count and issued targets can never disagree.
F13. Bound quantization direction (C-W1, B-W1). DECISION (direction-preserving, objectively correct): the sink quantizes a ceiling DOWN and a floor UP (a bound may tighten, never loosen); exact keeps ties-down; inverted evaluated ranges (min > max after evaluation) are refused where literal (literalDomain) and typed-absent (outOfDomain) at runtime otherwise; integer metrics (reps, sets) quantize to their integer grid at the sink. SPEC 4.2 rewritten; the "never prescribes more" claim corrected.

## Decisions ratified into warnings-fixes
F14. completed flag (A, B-W5, C). DECISION: the boundary filters uncompleted sets out before PerformedSet; the field leaves the kit shape entirely (one less thing for Rust to misread); SPEC states the boundary contract. This is the empty-finish law applied uniformly.
F15. Zero-logged slot (C-W2). DECISION: a slot with no logged sets in the closing session is UNTRAINED: no slotSession advance, handler records keep(untrained). Consistent with L11 and F14.
F16. Pause semantics (B-W2, A, C-W7). DECISION: status 'paused' becomes real (set on pause, cleared on resume); the lapse clock does not run while paused; a zero-length pause voids nothing; windows opened after resume behave normally. SPEC lifecycle table updated.
F17. capEffort on atMost v (B-W4). DECISION: result is the honest range [cap, v] when v ≥ cap (a deload cap must actually ease the set).
F18. moved()/demotion absence (B-W6, A, C-W9). DECISION: demotion applies only to present→present decreases; unset→value and value→absent are neither increases nor decreases for outcome policies.
F19. Duplicate snapshot facts (A). DECISION: latest observation wins (a post-session reading supersedes the issue-time one); spec the ordering key (observedAt, then ingestion).
F20. weekly(metric≠sets) (A, C-W9): count only slots whose plan carries the metric with a present value; silent fields contribute absence-aware (document where empty = 0 legitimately, i.e. a true empty sum); planned volume is taken AFTER policies and phase transform (A's trace warning F21 makes this visible).
F21. Trace completeness (A): applyUse preserves policy and phase-transform traces; the issued trace explains the ACTUAL numbers after policies and the sink.
F22. Issue identity (C-W6): issueKey incorporates the stamp's state digest (or seq) so distinct issues never share resolutions; resolution hashes computed over CANONICAL JSON (sorted keys), closing the key-order duplicate.
F23. Projection tagging (C-W10): projected issued sessions, ledgers, and handoff values are wrapped/branded as projected so L9 holds in the types, not just at the top level.

## Portability pinning (SPEC §7 rewritten; no JS-isms as hidden law)
P1. Canonical JSON (sorted keys, pinned number formatting) for ALL identity surfaces: frame keys, resolution hashes, content hashes. FNV input pinned explicitly (UTF-16 code units or code points; pick one, state it, test with a non-BMP char).
P2. Slot/collection ordering is DECLARATION order everywhere (arrays or insertion-ordered maps; no Object.keys integer-key reordering); allocate/pick/keys/boundary order tests with integer-like ids.
P3. LocalDay strictly validated (real calendar dates only; Feb 30 refused at the boundary with a refusal code).
P4. Arithmetic law: IEEE binary64 with the oracle's operation order for everything upstream of the sink (state it in SPEC; the sink alone was already pinned). cmpNum/epsilon policies unified (allocate cap comparisons use the same tolerance as floorQ); cmpNum non-transitivity and Infinity behavior documented or fixed.
P5. The nits with teeth: clock() "5:60/km" display fixed; empty-sum dimension rule stated; init order dependence either made order-independent (two-pass init) or refused by the checker; volumeKeep granularity stated; sameValue cause/dim handling stated; reshape/swapExercise runtime logging guard aligned with the checker's rules.

## Verification obligations
1. Freeze first: cp -R synthesis synthesis-ratified. All work in place in synthesis/.
2. Every F-item lands with its probe-derived regression test shown failing against synthesis-ratified (fail-first transcript saved to arena2/semfix-prefix.txt).
3. verify.sh all 8 steps green; fixtures regenerate; every CHANGED fixture listed with its cause (expect many: F6, F11, F13 move real numbers); the kit README's coverage table stays gap-free.
4. rationale.md: a "Semantics review round" section with the full F/P ledger, decisions marked OWNER-DIRECTED-DEFAULTS (standing objectively-correct directive), and the two reviewer-conflict adjudications (nth-empty reachability; anything else probes disagree on) recorded with the probe evidence.
5. SPEC sections 3, 4, 7 rewritten per above; seam-open-items.md gains a line marking item 6 (the adversarial read) RESOLVED with this round, and its conditions folded here.
6. Report honestly: what you could not finish, any F-item whose fix would change the grammar (STOP and report instead; the grammar stays frozen), and the final fixture/replay counts.
