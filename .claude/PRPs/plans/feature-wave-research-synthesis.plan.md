# Feature Wave — Research Synthesis & Build Plan (2026-08-09)

Four parallel deep-research passes (RPE/RIR, RP volume progression, TM/blocks/templates, proposals+UX) synthesized into one build order. Full reports in session history; this doc is the executable summary. Design-system constraints apply throughout: dark, one-volt rule, no new home surfaces, propose-don't-impose, silence over corruption.

## Build order

### 1. TM lifecycle (S+S+M+XS) — no schema changes
- Keep TM inside `progression` JSONB (no `training_maxes` table).
- New event-logged setter `set_training_max` → `program_events` `action: 'adjust_training_max'`, payload `{before, after, reason: 'cycle-end'|'reset'|'manual'|'block-restart'}` — the single call site for every TM change.
- Route `amrap-cycle`'s wave-completion bump through it (visible in history, no longer invisible inside derive).
- M4's "TM likely too high" flag → proposed ~10% reduction via the approval-card idiom ("Week 5, Squat: TM 140→126 kg — 3 straight stalls"). Never auto-write.
- e1RM prefill at exercise-add: `e1rm × 0.85` (Wendler 85–90%).
- NOT building: TM tables, test-week protocol, RPE-based TM rules (blocked on RPE data).

### 2. RPE/RIR opt-in logging (M)
- `sets`: nullable `rir` int + `rpe` numeric(3,1) + `prescribedRir`/`prescribedRpe` snapshots (instantiation-snapshot pattern). Store BOTH, no forced conversion (half-point RPE straddles RIR integers — Zourdos).
- Show rule: `set-has-prescribed-effort-target || userPreferences.rpeLoggingEnabled` (default false). NO new program flag (derive from structure); NO per-workout toggle.
- UX: post-completion inline chip row, skip-by-ignoring (Metric pattern), RIR-integer chips primary / RPE half-points advanced. 1-tap path byte-identical for opted-out.
- Unlocks immediately: autoreg RPE over/undershoot rules, RIR-adjusted e1RM (Helms/Zourdos), rpe-target loop closure.
- Anti-goals: default-on, pre-completion prompts, blocking modals, 19-option dials for beginners.

### 3. Proposals completion (S+S+M) — mostly built already
Already live: proposal = `programs` row w/ `status='proposed'` + `authorActor`; adopt/decline owner-only server actions; db-layer inertness; sharing reuses the surface. Remaining:
- Staleness affordance: `createdAt` age on proposal cards (never auto-expiry — silent corruption of a coach draft).
- `list_proposals` MCP read tool (coach can reference its outstanding drafts).
- **Batch-patch proposals** for ACTIVE programs: a grouped set of existing approval-card patch ops with ONE combined confirm — NOT a third entity, no patch-list table. This is the seam volume progression (below) lands on.
- Later increment if needed: tweak-then-adopt (edit draft inline pre-confirm).

### 4. Volume progression (L) — a proposal layer, NOT an 8th scheme
- Key finding: existing `weekly-volume` scheme is RP vocabulary on linear mechanics (deterministic per-exercise ramp). RP's real decision is per-MUSCLE-per-week, cross-exercise.
- Build: weekly trigger reading the existing planned/performed per-muscle aggregation (`db/muscle-volume.ts`/`planned-volume.ts`, `volumeWindows` boundary) + per-muscle verdict (+1/hold) → **batch-patch proposal** ("Add a set to Chest — pick: Bench +1 / Fly +1") through the layer from item 3, change-logged.
- v1 signal: performance-only, reusing autoreg stall detection aggregated per muscle (beat top-of-range 2+ wks on movements touching the muscle → eligible +1; stalled on ≥2 → hold). RPE avg ≥9 as a refinement once item 2 ships.
- NOT building: soreness/pump surveys (RP's most-criticized surface; pump lacks dose-response literature), hardcoded Israetel tables (RP itself refuses to publish one — landmarks stay per-program config), auto-mutation, daily check-ins, new home surfaces.
- UI: WHOOP-style 3-tier disclosure — per-muscle status chip (volt only for on-track) → trend → per-week table. Not RP's spreadsheet bars.

### 5. Block sequencing (S/M+S) — carry-forward hooks, not a state machine
- `cloneProgram` stays THE mechanism. Add restart-time TM carry-forward: clean block (no M4 flag) → one increment via `set_training_max` (`reason: 'block-restart'`) in the clone transaction; flagged → offer reset in a restart-flow confirm step.
- Lineage stays the single `sourceProgramId` event pointer. NOT building: program-series tables, accumulation/intensification phase modeling (theory nobody ships for solo lifters), auto phase transitions.
- Depends on item 1's setter.

### 6. Template library (XS+S+S/M+S+M)
- Templates = system-user-owned `programs` rows, `visibility: 'public'`; adoption = `adoptTemplate` (near-copy of `adoptShared`, minus token) → user's `draft`. All metadata columns (description/icon/hero/sourceUrl) already exist.
- Hand-author canonical set via existing MCP tools (5/3/1 BBB = amrap-cycle, GZCLP = double-progression tiers, Stronglifts = linear, PPL, upper/lower) — doubles as scheme-coverage validation.
- wger import as one-time seed script (M — external mapping is the risk). `/templates` browse reusing the article-card treatment.
- NOT building: a DSL (Liftosaur's identity, our regression), marketplace/ratings/community upload, live sync.

### UI patterns locked (from award/precedent research)
- TM review + volume proposals: approval-card sentence diffs (`describeToolCall` idiom) — no bespoke screens.
- Mesocycle timeline: horizontal week-pill rail (volt = current, icon = deload; never a calendar grid).
- Template gallery: the program article card, filtered — no second card style.
- Proposal review stays accept-whole-or-decline (edits post-adopt via the normal editor); our forced-confirm model is STRONGER than TrueCoach/Everfit's push-and-it's-live and is a differentiator to keep.
