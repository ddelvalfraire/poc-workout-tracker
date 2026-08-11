# RPE-Aware Autoregulation — Design Doc

Status: **design only, not scheduled** — implementation stays blocked on accumulated effort data (weeks of logged RPE/RIR), which is also the tuning input this design needs.

## 0. The one-paragraph version

The engine today autoregulates on *performance* (reps vs prescribed floor); the lifter's *perceived effort* (RPE/RIR) is captured per set but consumed by nothing. The upgrade: derive a per-exercise **rolling e1RM** from logged (weight, reps, RIR) and use it, plus top-set RPE vs the prescribed target, as a second evidence stream — layered as a pure post-hoc gate exactly like the diet-phase gate, never rewriting the existing verdict math. Evidence says RPE-based loading is at least as good as fixed percentages and probably slightly better (Graham & Cleather 2021; Helms 2018), but the effect is modest and RPE is noisy — so the design leans on trends over single sessions, byte-identity for exercises without effort logs, and the existing 3-stall rule as fallback.

## 1. What we have (codebase facts)

- **Capture already shipped** (RPE/RIR §2): `sets.rir` (int) and `sets.rpe` (numeric 3,1) logged via EffortChips, opt-in per user (`user_preferences.rpeLoggingEnabled`, default OFF); `sets.prescribedRir`/`prescribedRpe` snapshot the plan target at instantiation — same snapshot contract as `prescribedLoadKg`. **No scoring/autoreg/e1RM path reads them today** (display + MCP read-tools only). The engine even carries a stale comment (`autoregulate.ts:54-56`) claiming logged RPE doesn't exist — fix when this ships.
- **Engine shape**: 4 rule modes selected by scheme (`autoregPlan`, `programs.ts:1323`): FIXED (linear unranged; H2 3-stall decrement), RANGE (linear-ranged / double-progression; fill/hold/step), ANCHOR (rpe-target / weekly-volume / rep-progression), DELOAD-FLAG (percent-1rm / amrap-cycle; advisory only — those schemes own their loads).
- **Fixed laws to preserve**:
  - Prescriptions are snapshotted facts, never re-derived — RPE rules must score `rir/rpe` against `prescribedRir/prescribedRpe`, never live plan targets.
  - Evidence is load-keyed, never positional (C2, ε = 0.05 kg).
  - Silence over corruption — unscorable/ambiguous → null, never a guess.
  - The composition seam is `applyDietPhaseToAdjustment` (`autoregulate.ts:1064`): pure, post-hoc, additive fields, `===` passthrough when inapplicable. The RPE layer copies this shape.
  - History feed is `getRecentTrainedSessions` (`autoreg-history.ts:77`): 4-session window, 45-day recency, `weight_reps` only, deload-reset.
- **`rpe-target` scheme** already computes load from all-time-best e1RM via the RTS-chart curve (`schemeLoad`, `progression.ts:245-249`); the PRD's known gap is that a bad week never lowers it (best-ever is monotonic).

## 2. What the literature supports (evidence summary)

- **RPE↔%1RM is valid in trained lifters** (r ≈ 0.88–0.91, Helms 2017); the Helms/Zourdos chart maps (reps, RPE) → %e1RM but is a conceptual reference — individual variance is real.
- **RIR reports sandbag by ~1 rep on average** (Halperin 2022 meta, n=414); error is small at ≤12 reps and near failure, large above 12 reps and far from failure. Treat logged RIR 0 as "0–1"; ignore effort data from >12-rep or <RPE-7 sets when estimating e1RM.
- **Autoregulated loading ≥ fixed loading** (Graham & Cleather 2021 significant for squat/DL; Helms 2018 non-significant but directionally favorable). Modest effect → don't over-engineer.
- **Single-session RPE is noisy** (readiness varies day to day) → the control signal is the **rolling e1RM trend**, not any one session. This is also the Emerging-Strategies insight (time-to-peak read off the e1RM series) and how RPE-aware apps (JuggernautAI-style) trigger deloads: flat/declining e1RM with rising RPE, not a missed rep on a bad day.
- **APRE precedent**: reps-achieved-driven next-load tables beat linear periodization in the one direct RCT (Mann 2010) — performance and perception evidence should compose, not compete.
- **Step sizes**: 2.5–5% (or smallest plate step) everywhere in practice; small steps beat big ones.

## 3. Design

### 3.1 New primitive: per-exercise rolling e1RM

- Per qualifying top set: `e1RM = effectiveLoadKg × (1 + (reps + rir) / 30)` (Epley with RIR credit). Qualifying = `weight_reps`, reps ≤ 12, logged RIR ≤ 3 (or RPE ≥ 7), completed, working set.
- Rolling signal: EWMA (or plain mean) over the last 3–5 qualifying top sets, computed inside the existing history window machinery (`autoreg-history.ts`) — **no new tables**; it's derived at read time from the same set rows, consistent with "never re-derive past prescriptions" (the e1RM shapes *future* prescriptions only).

### 3.2 The RPE gate (new pure layer, diet-phase shape)

`applyEffortToAdjustment(adjustment, effortEvidence): AutoregAdjustment | null` applied in `deriveDayPrescription` right after `applyDietPhaseToAdjustment`:

- **Overshoot** (reps hit, avg top-set RPE ≥ prescribed target + 1): downgrade a would-be `step` to `repeat` ("hot session — holding the load"). Annotate `effortContext: 'overshoot'`.
- **Undershoot** (reps hit, avg top-set RPE ≤ target − 1, sustained 2 consecutive sessions — mirror of M2's two-session confirm): permit a step even where the scheme would hold, or annotate a `suggestedStepKg` the UI/proposal path can offer. Never auto-apply a larger-than-scheme increment in v1 — surface it as a proposal (reuse the reactive-deload proposal seam).
- **Trend-aware stall veto**: if the rolling e1RM is *rising* across the window, veto H2's decrement (downgrade to `repeat` + annotation) — a missed-rep day on a rising trend is a bad day, not a stall. Conversely the 3-stall rule stays the trigger; e1RM trend never *initiates* a decrement in v1, it only vetoes/annotates.
- Additive fields only (`effortContext`, `suggestedStepKg`, `e1rmTrend`), `===` passthrough when no effort data — byte-identity for non-RPE users, mirroring `phaseContext`/`heldBackoffKg` exactly.
- Composition order: diet-phase gate runs first (holds are sacred); the effort gate must never un-hold a cutting hold.

### 3.3 `rpe-target` scheme fix (independent, could ship first)

Replace the all-time-best e1RM input with the rolling e1RM (window-scoped), so a bad RPE week actually lowers next week's load. This is a `progression.ts`/`ExerciseHistoryInput` change with no gate involvement — the PRD already calls for it, and it's the smallest shippable slice of this whole design.

### 3.4 Data plumbing

- `getRecentTrainedSessions` select + `AutoregHistorySession.sets` gain `rir`, `rpe`, `prescribedRir`, `prescribedRpe` (4 columns, additive).
- `AutoregSession.prescribed/.actual` types gain optional `rir`/`rpe` (nullable, like `repMin`).
- `autoregReason` gains branches for the new annotations ("Hot session at 100 kg — holding" / "Trend rising — bad day, not a stall").
- Update the stale `autoregulate.ts:54-56` comment.

### 3.5 Activation guardrails (silence over corruption, extended)

- The gate activates per exercise only with **≥3 RPE-logged qualifying sessions** in the window; below that it passes through untouched (existing engine runs as today).
- Never chain automatic reductions off effort evidence; never move loads >5% off any effort signal; high-rep (>12) and low-effort (<RPE 7) sets never feed e1RM.
- v1 explicitly excludes: per-day readiness multipliers, RTS-style intra-session fatigue stops (needs live set-by-set UX — v2 note), bodyweight logging types (engine assumes absolute kg), and per-user RPE-bias calibration (v2 once AMRAP ground truth accumulates).

## 4. Shipping order (when unblocked)

1. **Slice 1 — rolling e1RM + `rpe-target` fix** (no gate; behavior changes only for rpe-target schemes). Smallest, independently valuable.
2. **Slice 2 — history plumbing + effort types** (pure additive, zero behavior).
3. **Slice 3 — the effort gate** with overshoot-hold + trend veto only (the two conservative rules).
4. **Slice 4 — undershoot step proposals** through the reactive-proposal seam (owner-confirmed, never auto).
Each slice: TDD, byte-identity tests for the no-effort-data path (reference-equality, same as diet-phase's), full review.

## 5. Resolved decisions (from the research — not open)

- **Overshoot threshold: target +1 RPE.** Halperin 2022: between-person reporting SD ≈ 1.45 reps and ~1-rep systematic sandbagging — a ±0.5 distinction is inside the noise floor of the instrument. The engine reacts only to a full-point overshoot; anything finer is reacting to measurement error, which violates silence-over-corruption.
- **Trend veto applies to H2's decrement only; the M4 flag stays visible.** The veto exists to stop the engine *changing loads* off what the trend proves was a bad day. M4 never touches loads — it's advisory information, and the deload-policy design already gives 'none' users the switch that silences it. Hiding cheap advisory information behind a trend heuristic adds a failure mode (trend wrong → flag lost) with no corresponding safety gain.
- **Undershoot proposals ride the existing proposal machinery, `source: 'effort-step'`.** The dedup subject infrastructure (partial unique index on program + source + muscleGroup-as-subject) is already generic, the approval-card surface already renders per-patch sentences, and the deload-policy memory explicitly deferred proposal flows TO the batch machinery — building a second surface would revisit a settled decision. Only the copy inverts (offering *more* load), which is a sentence, not a surface.
- **Minimum data: 3 qualifying RPE-logged sessions.** Forced by the architecture, not just preference: the history window is 4 sessions (`AUTOREG_RANGE_SESSION_WINDOW`, 45-day recency), so a 5-session minimum could never be satisfied without widening the window — a bigger change than the guardrail it serves. The literature's caution about small samples is already absorbed upstream: the gate acts on the rolling trend (never one session), holds are its only automatic action, and steps go through owner confirmation.

## Sources

RTS/Tuchscherer (store.reactivetrainingsystems.com — beginning-rts, fatigue-percents-revisited) · Helms et al. 2016 RIR-RPE scale (PMC4961270) · Zourdos et al. 2016 (PMID 26049792) · Helms et al. 2017 r=0.88–0.91 (DOI 10.1519/JSC.0000000000001517) · Helms et al. 2018 RPE vs % (DOI 10.3389/fphys.2018.00247) · Graham & Cleather 2021 (PMID 31009432) · Halperin et al. 2022 RIR accuracy meta (DOI 10.1007/s40279-021-01559-x) · Mann et al. 2010 APRE (PMID 20543732) · RP volume landmarks (rpstrength.com) · StrongLifts stall rules (stronglifts.com) · VBT overview (scienceforsport.com)
