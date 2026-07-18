# Program Change Log — append-only audit of plan mutations

## Problem Statement

Program edits mutate the plan in place with no record: the builder, the 14 MCP patch tools, and now the coach's approved patches all rewrite prescriptions silently. "Why is my Tuesday different?" is unanswerable after the fact — the coach's approval card is gone the moment it's tapped, and a mid-block edit rewrites the baseline program-stats derive from with no marker that week 3's prescription was born different from week 1's. Workout history is protected facts (provenance-is-a-fact); the plan's own history doesn't exist.

## Evidence

- Every mutating path funnels through two modules — `src/db/program-patches.ts` (narrow patches) and `src/db/programs.ts` (upsert/restart/status) — so there is a single seam to record at, and today it records nothing.
- The coach shipped 2026-07-18 (PR #83): an AI agent now edits programs. Its approval UX is review-at-edit-time only; nothing persists for review-after-the-fact.
- Coarse history exists only via block cloning (restart archives the old block) — useless for within-block edits, which are exactly the ones auto-regulation and mid-block swaps produce.
- Direct user ask (2026-07-19): "how are we keeping track of updates and deviations… we have to make sure we are handling that intelligently."

## Proposed Solution

An append-only `program_events` table written at the existing mutation seam — facts about plan changes, mirroring the provenance philosophy (record, never rewrite):

- **Row shape**: `id`, `programId` (FK, cascade), `userId`, `occurredAt`, `actor` (`'ui' | 'mcp' | 'coach'`), `action` (the patch/tool name, e.g. `update_program_exercise`), `summary` (one compact human line: "Replace Incline DB Press → Larsen Press (Day 2)"), `payload` jsonb (minimal before→after, e.g. `{"before":{"wgerExerciseId":123},"after":{"wgerExerciseId":456}}`).
- **Actor derivation needs no new plumbing**: server actions write `'ui'`; the MCP layer distinguishes `'coach'` from `'mcp'` by the authInfo `clientId` the in-memory bridge already stamps (`'coach-chat'`) vs. the HTTP transport.
- **Write once, at the db layer**: one insert per mutating call inside the same transaction — a failed patch logs nothing, a logged event implies the change committed.
- **Surfaces**:
  1. A "Changes" timeline section on the program detail page (newest first, actor-labeled, paginated).
  2. **MCP tooling**: a read tool `list_program_changes` (`programId`, optional `limit`/`before` cursor) returning the same rows — added to the coach's read allowlist so the coach itself can answer "what changed on my program last week?" (the exhaustive tool-policy partition test forces the triage).

## Key Hypothesis

We believe an append-only, actor-attributed change log will make every plan mutation — human or agent — explainable after the fact. We'll know we're right when "why is this slot different?" is answered from the timeline (or via `list_program_changes` in a chat) without reconstructing it from memory.

## What We're NOT Building

- **Undo/rollback/versioning** — events are facts about changes, not snapshots to restore. Restart-as-clone remains the coarse rollback.
- **Full structural diffs** — payload captures the fields the action touched, not whole-program snapshots.
- **Workout-level events** — workouts are already immutable facts with provenance; edit history there is a separate (unproven) need.
- **A write/mutation MCP tool** — the log is read-only by construction; only the db layer appends.
- **Retention/pruning** — rows are tiny and per-user; revisit only if it ever measurably matters.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Coverage | Every mutating call in program-patches.ts and programs.ts writes exactly one event, in-transaction | Unit tests per action + a completeness test enumerating the module's exports |
| Actor truth | UI, plain MCP, and coach edits are labeled correctly | Bridge/route tests (clientId derivation) |
| Surfaces | Timeline renders the same rows `list_program_changes` returns | Shared read function; tool + page tests |
| Zero read-path cost | No existing query gains a join; events are their own reads | Code review |

## Open Questions

- [ ] Payload granularity for `upsert_program` (full-replace): one coarse "program replaced" event vs. computed per-slot diff — lean coarse for v1 (upsert is excluded from the coach anyway).
- [ ] Should the coach's event also reference the chat turn (message id) for "show me the conversation that made this change"? Cheap if the id is already in scope; skip if it threads new state.
- [ ] Timeline placement: section on the program page vs. its own `/programs/[id]/changes` route — decide by how long it renders in practice.
