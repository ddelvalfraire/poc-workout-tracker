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

### 7. Notes revamp + reusable editor (M/L) — researched 2026-08-09
- Audit verdict: 9 free-text surfaces, most dead-ends; `getLastPerformance` excludes notes at the SQL layer; exercise-IDENTITY notes don't exist at all (the "seat pin 4" gap).
- Build: new `exerciseNotes(userId, source, exerciseId, body markdown, pinned)` table (unique per user+identity), LEFT JOIN into getLastPerformance, sticky-chip resurfacing in the logger (Strong's pin pattern, Hevy's routine-note semantics — contextual resurfacing beats note lists, unanimously).
- Editor: **TipTap** (smallest tree-shakable core, first-party bidirectional markdown, BlockNote layers on it later if blocks ever needed). **Markdown strings are source of truth** (agents read/write markdown, never editor JSON). Two variants of one component: QuickCapture (bottom sheet, bold/lists/links only) and FullEditor (toolbar-above-keyboard — Notion's own mobile fallback; slash menus fight predictive text). Read-only = lightweight markdown renderer, never the editor bundle.
- Program articles get their first human authoring UI (FullEditor on description); template-edit-sheet textarea retires onto QuickCapture. `programs.notes`/`programDays.notes`: decide (repurpose-private or deprecate), don't carry forward ambiguous.
- Zero data migration (existing text is valid markdown). New MCP tool `set_exercise_note` (identity-scoped; set_exercise_meta stays instance-scoped).
- NOT building: blocks/embeds/tables, collab, version history, global notes tab, attachments, JSON storage.

### 8. De-carding the visual vocabulary (design pass) — researched 2026-08-09
- Audit: 79 rounded-2xl cards / 39 files; 99 pills / 48 files doing 3 unrelated jobs. Worst: programs/[id] — six day states, one shell.
- Direction: FINISH what's started, don't import a language. Program day list → Things-3 divider list (ADA-verified, lowest risk); extend StatusHero's status-as-words (Gentler Streak STRUCTURE only — never its palette); stats → tiered/timeline disclosure (Day One/WHOOP).
- Keep-list (locked): one-volt rule, StatTile contract, sheet-only glass, actor-chip pills, and the logger fast path is OFF-LIMITS (load-bearing state interleaved with visuals).
- Risks: illustrated assets vs PWA precache budget (no asset budget doc exists — write one first); directions tempting a second accent must be re-specified monochrome+volt before any code.
- Sequencing: pairs with #7 (notes chips/article surfaces born into the new vocabulary); program-page divider-list conversion is the natural first PR.
- **APPROVED 2026-08-09** (visual mock: claude.ai artifact "De-card Design Preview" — program page + logger frames). Runs AFTER TM lifecycle ships. Conversion map (cards/pills counted):
  - Convert: logger (reskin only — "affordance follows work": done sets flatten to text, live set is the only input-affordance row, underline fields, Finish as full-bleed volt text band), workout summary 6/4 (best candidate — read-only; shares flattened set-line component with logger), program page, programs list 2/1, settings 2/0 (divider rows), exercise detail 4/0, stats shell 2/0 (StatTile itself stays).
  - Keep deliberately: coach chat bubbles + approval cards (chat convention/decision units; only tool chips soften), templates gallery cards (content preview is a correct card use), StatTile, bottom sheets, sticky bars, actor chips. Home/history/exercise-search already healthy.
  - **Feature-parity contract (hard rule per reskin PR)**: render-layer only — no reducer/action/handler/query/prop removed; per-surface affordance checklist enumerated pre-PR and verified in review (logger list: tap-complete, Prev-fill, swipe-delete, steppers, long-press tags, collapse, stats-sheet tap, replace, plate/rest sheets, next-up scroll, undo); full suite + review gauntlet as always.
  - Order: logger → workout summary → program page → programs list + settings + exercise detail → stats shell.

### UI patterns locked (from award/precedent research)
- TM review + volume proposals: approval-card sentence diffs (`describeToolCall` idiom) — no bespoke screens.
- Mesocycle timeline: horizontal week-pill rail (volt = current, icon = deload; never a calendar grid).
- Template gallery: the program article card, filtered — no second card style.
- Proposal review stays accept-whole-or-decline (edits post-adopt via the normal editor); our forced-confirm model is STRONGER than TrueCoach/Everfit's push-and-it's-live and is a differentiator to keep.
