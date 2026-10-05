# Units addendum spec (owner-ratified 2026-10-04)

Owner ruling: users can define programs in lb and kg, mixed; handle it by conversion
with the grid exception. Three laws, two changes.

## The laws (SPEC gains a "Mixed units" statement consolidating them)
U-L1. One canonical unit per dimension inside the engine (mass: kg). Conversion at
      the boundary is exact: 1 lb = 0.45359237 kg (the exact legal definition),
      pinned in SPEC with the operation order (multiply by the factor, binary64,
      no intermediate rounding). All state, arithmetic and hashes are canonical.
U-L2. A grid is never converted. Quantization happens against the grid in the grid's
      declared unit; the issued value's display unit IS the grid's unit (existing F11
      rule, now stated as part of this law). Converting a grid, or re-quantizing a
      converted display value, is inexpressible/refused, not merely discouraged.
U-L3. Viewer-unit conversion (C11) is display-only: converted prose carries a stated
      rounding (the existing three-decimal rule, pinned in SPEC beside the factor),
      never feeds back into any engine value, and loggable surfaces (ghosts, plan
      targets, session text's actionable numbers) stay grid-native. Already true;
      make SPEC say it as law.

## Changes
U1. **Pin the conversion.** units.ts: the kg/lb factor as the single named constant
    0.45359237 (and its use for any existing lb handling audited to go through it);
    SPEC section 6/7 states the factor, direction, operation order, and the display
    rounding rule. Conformance: a fixture with a lb-declared quantity whose canonical
    kg value and whose displayed lb round-trip are pinned, including a non-trivial
    value (e.g. 135 lb → 61.23497 kg exactly) and a viewer-converted prose line.
U2. **Per-slot grids.** `grids` stays the program default; a slot may declare its own
    grid per metric (SlotMeta, beside success/muscles), winning over the program's for
    that slot's sink, prose and display unit. Same one-form law: a slot grid equal to
    the program's is refused (the Y4 options-table posture; wire it through the same
    table). Checker: slot grid unit must match the metric's dimension (existing
    unitMismatch posture). Ties (C6) apply unchanged; the stamp already carries ties,
    and the stamped prescription's grid is the one it was issued under (stamp carries
    the resolved grid or enough to re-derive nothing). Worked example: a program with
    a kg default grid (machines) and a lb slot grid (barbell), both directions
    exercised in fixtures (issue, sink, prose, resolution).
U3. **Mixed-unit composition fixture.** One worked program declaring an increment in
    lb against a kg grid and vice versa, pinning: exact canonical math, sink onto the
    grid's unit, prose in grid units, viewer conversion per U-L3. This is the
    regression that keeps "just convert, except grids" true forever.

## Process (same discipline as every round)
1. Starts ONLY from the landed configurability-fix tree (after Y1-Y13); freeze
   cp -R arena2/synthesis arena2/synthesis-cfgfix first.
2. Fail-first where behavior exists to contrast (U2's slot-grid refusals and any
   current implicit conversion path); transcript arena2/units-prefix.txt.
3. Grammar: U2 is a SlotMeta field widening, no new former expected; anything larger
   STOP and report.
4. verify.sh green; kit regenerated; changed fixtures listed with cause (expected:
   added fixtures only, plus SPEC/schema; no existing value moves).
5. rationale.md "Units addendum" section; kit-spec section 7 table gains the slot
   grid row; the Declared options table stays the Rust room's single source.
