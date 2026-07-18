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
