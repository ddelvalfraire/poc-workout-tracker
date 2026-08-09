# Auto-Regulation — performance-reactive prescriptions

## Problem Statement

The progression engine derives week-N prescriptions from static rules plus history-derived e1RM, but nothing reads how the sets actually *went*. A lifter who missed reps at RPE 9.5 last session gets the same +2.5 kg next week as one who cruised at RPE 7; a grinding block rolls on until the calendar deload arrives. The feedback loop — the half of progression that makes a program adaptive — doesn't exist.

## Evidence

- Engine reality: `src/lib/progression.ts` derives loads from scheme + trainingMax/e1RM; no scheme consults prescribed-vs-actual reps or logged RPE. `rpe-target` uses best-recent e1RM, so a bad week *raises* nothing but also lowers nothing.
- Market scan (2026-07-17 research): progression automation is a top-3 demand signal; Liftosaur owns scriptable progression but intimidates mainstream users; Fitbod/Alpha Progression adjust but can't explain why ("black box" is the recurring criticism). Transparent, inspectable adjustment has no owner.
- AI-sentiment finding from the same research: adjustments grounded in *logged performance* earn trust; vibes-based AI coaching triggers skepticism. Layer 1 needs zero new user input.
- The data mostly exists: prescribed targets (plan ghosts) and actual reps are logged today. **Correction (2026-07-19): actual per-set RPE is NOT logged** — `rpe` lives only on program prescriptions (`program_sets`/`program_set_overrides`), never on logged `sets`. RPE-based rules are blocked on an optional per-set RPE input; v1 ships rep-based rules only.

## Proposed Solution

A pure `autoregulate` module layered between scheme derivation and overrides (below overrides in precedence — an explicit override always wins), applied propose-then-accept in the logger:

**Layer 1 — performance-reactive rules (this PRD's scope):**
- *Missed reps* on linear/double schemes → repeat the load instead of incrementing; decrement after two consecutive stalls.
- *RPE overshoot* (logged ≥1.5 over target across working sets) → hold the next increment; *undershoot* (≥1.5 under) → allow a double increment. **[Deferred: blocked on actual-RPE capture — see Evidence correction.]**
- *Early-deload suggestion*: two consecutive sessions of overshoot/misses on an exercise surfaces "pull the deload forward?" — suggestion only, never automatic.
- `rpe-target` derives from a rolling-window e1RM (last N sessions) instead of best-recent, so a bad week actually lowers next week's loads.

**Layer 2 — transparency (ships with Layer 1):** every adjustment carries a machine-readable reason (`derivedFrom: 'autoreg'` + reason string, e.g. "−2.5 kg: last week hit RPE 9.5 vs target 8"). Rendered as ghost-target subtext in the logger and in `preview_program_week` output. The reason is the differentiator, not the math.

**Delivery — propose, don't impose:** at session start the logger shows adjusted targets with reasons and a one-tap "use plan as written" escape. The MCP agent drives the same proposals ("preview next week, show your math"). Matches provenance-is-a-fact: the plan is never silently rewritten.

## Key Hypothesis

We believe performance-reactive, visibly-reasoned target adjustments will replace the lifter's own mental arithmetic about when to push, hold, or back off. We'll know we're right when a stalled lift stops re-prescribing failed loads (and the shown reason matches what a coach would say), verified against the live block's history.

## What We're NOT Building

- **Readiness check-ins** (sleep/soreness surveys à la JuggernautAI) — deferred; trust flows from logged performance first. Revisit after Layer 1 proves out.
- **Automatic plan mutation** — proposals only; accepting writes nothing to the program (the adjustment is per-session guidance; overrides remain the explicit persistence path).
- **Configurable rule thresholds** — v1 ships fixed, commented constants (mirror weekly-muscle-volume's approach).
- **New schema** — reads existing sets/RPE/targets; no new tables or columns.
- **ML/opaque models** — rules must stay explainable in one sentence each.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Stall handling | A lift with missed reps last session proposes repeat-not-increment, with reason | Unit tests + live-block spot check |
| Transparency | Every adjusted set exposes a reason string in logger + preview tool | Tests on the derive path |
| Override supremacy | An explicit per-week override is never modified by autoreg | Unit test (precedence) |
| Zero added input | Layer 1 consumes only already-logged data | Code review |

## Open Questions

- [ ] Rolling-window size for `rpe-target` e1RM (3 sessions? time-boxed 21 days?) — decide during implementation against real history.
- [ ] Where the "use plan as written" choice lives (per-exercise vs per-session) — prototype both in the logger.
- [ ] Whether accepted proposals should stamp provenance on the workout (`derivedFrom` per set in the saved data) for later analysis — leaning yes if it stays additive.

## v1.1 — adversarial revision (2026-07-19)

Three adversarial reviews (math-executed, training-domain, data/integration) hardened the v1 rules:

- **Snapshots are the facts.** "No new schema" is retracted: instantiation now stamps each set with `prescribed_load_kg`/`prescribed_rep_min` (plus its true `set_type`), and stall verdicts score actuals against those immutable snapshots — never a re-derivation of today's editable plan. Pre-snapshot history is unscorable, so the engine stays silent until post-migration sessions accrue (cold start by design). The snapshots survive every edit path, including the logger's full-replace save.
- **Pairing by setNumber.** Prescribed and actual sets match on `setNumber`, not filtered position — a skipped AMRAP row or an extra ad-hoc set can no longer shift the scoring frame. Unpaired entries are ignored.
- **Per-set caps.** Evidence names the heaviest missed set, and each next-week set is capped against its *own* prescribed-at-stall load: a top set that passed at 100 kg is never slashed because a 90 kg volume set failed. Backoff/AMRAP sets are frozen (and scaled on decrement) so volume work cannot ratchet past a frozen top set; the verdict itself stays working-sets-only.
- **Three-stall escalation.** One or two consecutive stalls repeat the load; the decrement (~10%, increment-snapped, capped at 25% of the load) and the early-deload suggestion now require *three* consecutive stalls — StrongLifts' cited rule. History window is 3 sessions.
- **Evidence hygiene.** Only completed, trained workouts testify (no live-session evidence on preview paths); sessions order by startedAt with id tiebreak; evidence expires after 45 days; one session per calendar day; any deload-week session resets stall memory (only sessions after it count).
- **Linear only.** v1 scope narrows to the `linear` scheme. Double-progression already holds until repMax (a stall there is the scheme working); percent-1rm is *not* self-correcting (static trainingMax — future work); amrap-cycle bumps unconditionally (future work); rpe-target self-corrects via e1RM.
- **Toggle integrity.** The program-level switch no longer materializes a default on parse: an upsert that omits it preserves the stored value; only creation defaults to ON.

## Adversarial review (2026-08-08)

A 3-agent adversarial review (math-executed corruption constructions, training-methodology audit, data/integration audit) produced one CRITICAL, six HIGH, and four MEDIUM findings. All were fixed on `fix/autoreg-hardening`; each fix carries a regression test named after its finding id.

### Findings and locked decisions

- **C2 (CRITICAL, executed corruption) — positional set identity is dead.** `stalledLoadBySetNumber`/`anchorLoadBySetNumber` keyed cross-session evidence by `setNumber`, but program edits renumber sets positionally, so historical snapshots misattributed across edits: a stalled set escaped its cap, foreign sets got capped/mislabeled (verified constructions: insert-set shift; a 140 kg top set landing on a 20 kg set's old position). **Decision:** all cross-session evidence is LOAD-keyed (ε-bucketed on the prescribed load, `LOAD_EPSILON_KG` semantics): a stall at prescribed load X caps today's working sets whose scheme load ≥ X − ε to the stalled outcome; anchors, comparable totals, range tops, and plan-sync application key the same way. Prescribed↔actual pairing WITHIN one session may still use `setNumber` (internally consistent); nothing cross-session may.
- **C1 — stall = ANY scorable working set under its floor** (the StrongLifts/Starting Strength failed-session definition). The prior half-threshold let the linear increment ride over 8,8,6. Repeat-before-decrement cadence unchanged.
- **H1 — follow the lifter down.** Three consecutive comparable sessions worked entirely at ≤ prescribed × 0.95 with the rep floors met propose anchoring the working loads DOWN to the actually-used loads (load-keyed), with a reason line naming the evidence. Lighter-attempt sessions are their own streak class — no longer silent no-evidence. RTS/Juggernaut precedent: load selection is itself the primary autoregulation signal.
- **H2 — load-scoped fixed-mode stall streak.** Consecutive stalls count toward the decrement only while the prescribed top working load is unchanged (within ε); any change — including an applied back-off — resets the streak. Kills the 10%→10% cascade.
- **H3 — mixed template rows keep range protection.** When some working sets carry a real repMin–repMax range and others don't, ranged rows are scored by fill/hold and fixed rows join floor scoring only; the whole-exercise null fallback is gone. Zero ranged sets → fixed rules as before.
- **H4 — exercise-scoped trained predicate.** The history window's EXISTS is scoped to the exercise's composite identity (source + wgerExerciseId) having ≥1 completed set in the workout — a workout where the exercise was skipped no longer burns window slots or resets streaks.
- **H5 — slot dedup.** The window dedups by (programDayId, programWeek), keeping the most recently started, before the calendar-day dedup — a re-instantiated completed slot can't double-count. (No DB unique constraint in this change.)
- **H6 — enforced ordering contract.** `AutoregSession` carries a required `startedAtMs`; every entry point sorts descending on it defensively instead of trusting array order.
- **M1 — near-fill flat is HOLD.** A range-mode flat-total streak decrements only when the flat total is < (fill − 1 rep); at fill−1 or closer the verdict stays HOLD.
- **M2 — up-anchors need confirmation.** Outperform/up-anchor proposals require 2 consecutive qualifying sessions, in the derive engine and in plan-sync (the day's previous completed session must also have outperformed its snapshots). First anchors onto load-less prescriptions stay single-session.
- **M3 — evidence quorum.** No verdict of any kind without scorable evidence on ≥ ceil(snapshotWorkingSetCount / 2) of the snapshot's working sets. Single-working-set exercises remain 1-of-1 (unavoidable) — but combined with M2 their up-anchors still need 2 sessions.
- **M4 — percent-1rm and amrap-cycle get the early-deload flag.** Floor-only stall scoring for these schemes drives `suggestEarlyDeload` ONLY (never a load adjustment — the scheme owns its loads), after the same 3-streak, reason "training max likely set too high" (5/3/1's failed-cycle rule), surfaced through the same reason/flag plumbing as the existing suggestion.

- **H3v2 — mixed-top buckets cannot step (verification pass, 2026-08-08).** The independent verification of this hardening re-broke H3: two ranged rows sharing one load bucket with *different* tops let the optimistic best-reps→highest-top match launder a top-target miss into a fill and a load increase. Fix: misses stay optimistic (only certain misses stall), but a heterogeneous-top bucket's fill is unconfirmable — hold, not step. Regression test `H3v2` encodes the executed construction. The remaining 12 findings were verified CONFIRMED-FIXED with attack-encoding tests; the ε-boundary evidence-blend noted by the verifier is bounded by design tolerance.

### Accepted limitations

- **Backdating as a window-manipulation surface.** `startedAt` is user-editable, so a backdated workout can reorder or displace the evidence window. Single-user app, MCP-only write surface — accepted.
- **Frequency-blind 3-session window.** Three sessions is three sessions whether they span one week or five (inside the 45-day recency cutoff); training frequency does not scale the streak. Documented, not changed.
- **Warm-up retag sensitivity.** Retagging sets working↔warmup still moves evidence in and out of scope beyond what the new quorum absorbs. Accepted; the quorum bounds the blast radius.
