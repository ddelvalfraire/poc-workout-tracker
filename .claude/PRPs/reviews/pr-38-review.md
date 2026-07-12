# PR Review: #38 — fix: starting a day resumes its existing unfinished instantiation

**Reviewed**: 2026-07-09 · **Branch**: fix/resume-existing-day-instantiation → main
**Decision**: APPROVE (MEDIUM fixed in 912890d)

## Summary
Verified: ownership scoping and isNull semantics; targetWeek resolved before the lookup on both week paths with weekDerived preserved; legacy null-programWeek rows correctly excluded; callers (action, StartDayButton, MCP tool) assume nothing about freshness; Discard-&-start-new ordering holds (discard completes before instantiate — can't re-resume the deleted row); prescription/history reads structurally skipped on resume.

## Findings
- **MEDIUM [FIXED]**: the derived-week resume path had no explicit coverage (passed by empty-queue coincidence). New test derives week 2, resumes at that week, asserts zero inserts + the completed_at predicate at the shifted select index.
- **LOW (follow-up ticket)**: true-concurrency double-start can still race the read-then-insert; a partial unique index on `(user_id, program_day_id, program_week) WHERE completed_at IS NULL` would close it — same accepted single-user-POC class as the file's documented FK race.
- **LOW (doc pass)**: MCP `instantiate_program_day` description doesn't mention resume semantics.

## Validation
tsc / lint pass; 19/19 in the extended file; 831 on merged main.
