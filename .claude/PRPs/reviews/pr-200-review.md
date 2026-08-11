# PR Review: #200 — feat: list_templates + adopt_template MCP tools

**Reviewed**: 2026-08-10
**Author**: ddelvalfraire
**Branch**: feat/template-mcp-tools → main
**Decision**: APPROVE

## Summary
Thin MCP surface over the existing template-library db ops; all gating (public + system-owned, can() at clone time, private draft copy) already lives in `adoptTemplate` and is untouched. Coach partition handled deliberately in both directions.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
None

### LOW
- `list_templates` resolves `userId` only to echo it (the library is global) — consistent with every other tool's envelope, fine.

## Security notes
- `adopt_template` cannot be aimed at another user's program: the db op is owner-scoped to `TEMPLATE_OWNER_USER_ID` and re-validates `can(adopt)` — a user's own row with that id can never be selected.
- Coach exclusion is enforced server-side by the allowlist filter (excluded tools are never visible to the model); the partition test pins that every tool is allowed XOR excluded, so the new tools can't silently fall through.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Lint | Pass |
| Tests | Pass (3,037 / 210 files; 2 new tool tests, 3 pins updated) |

## Files Reviewed
- `src/lib/mcp/program-tools.ts` — two registrations + import
- `src/lib/mcp/program-tools.test.ts` — mock + tests + 11-tool pin
- `src/lib/mcp/tools.test.ts` — full-registry pin
- `src/lib/coach/tool-policy.ts` — read-tier add, explicit exclusion
