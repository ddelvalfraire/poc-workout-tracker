# PR Review: #20 — plate calculator + warm-up ramp

**Reviewed**: 2026-07-06 (pre-merge, per review-before-merge rule)
**Branch**: `feat/plate-calculator` → `main` (1 commit, 15 files, +1700/−5)
**Decision**: APPROVE

## Findings
### CRITICAL / HIGH / MEDIUM
None.

### LOW (accepted)
1. **PlateSheet has no focus trap or Escape handler** — hand-rolled bottom sheet (repo has no dialog primitive); `role="dialog"`, `aria-modal`, labelled controls, and backdrop-close are in place. Revisit if a dialog primitive lands.
2. **Sequential equipment fetch on /workout/new** — `getEquipment(userId, unit)` needs the unit from the preceding `Promise.all`; the dependency is real, one extra round-trip accepted.

## Checked and clean
- Greedy loader works in integer cents (no float drift for 2.5 lb / 1.25 kg); unbuildable targets report closest-achievable, never lie.
- Warm-up ramp steps are plate-buildable by construction; dedupe/bounds proven by tests (14 plate-math + 7 equipment).
- Equipment is unit-native with defaults on mismatch/malformed storage; write path validated at the action boundary (bounds, counts, dedupe); jsonb column nullable and additive (migration 0008 applied).
- Bar choice is ephemeral sheet state (user direction); "No bar" covers plate-loaded machines; icons from lucide-react (user direction).
- E2e asserts live kg math (100 → 25+15/side on a 20 bar) + ramp render + close.

## Validation
tsc ✅ · scoped eslint ✅ · 663 unit tests ✅ · build ✅ · live e2e ✅

---

## Round 2 (post-merge /code-review, 2026-07-06) — findings fixed in #21 / `8a6ff86`

### MEDIUM
1. **Plate sheet could clip off-screen on phones** — no max-height meant many distinct weights + the ramp + the open gear editor could exceed the viewport with the overflow unreachable. Fixed: `max-h-[85dvh]` + `overflow-y-auto`.

### LOW
2. **`setEquipmentAction` had no action-layer tests** — parse logic was covered in lib, but not the auth → validate → persist → revalidate wiring. Fixed: 2 tests (short-circuit on invalid; normalized persist + layout revalidate).
3. **Background scroll not locked behind the sheet** — accepted, cosmetic.

Validation after fixes: tsc ✅ · scoped eslint ✅ · 665 unit tests ✅ · build ✅. Deployed to production.
