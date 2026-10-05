# Configurability round spec (owner-ratified 2026-10-04)

Owner ruling, verbatim intent: "make it configurable where needed or where we choose a
specification for the user. the entire point of the language is to give users all the
power to define programs." Every item below was independently classified
SHOULD-BE-DECLARED by the three interrogation reviewers (patrev-a/b/c reports); their
concrete proposals are folded in. Engine LAWS (determinism, directional sink, three-valued
verdicts, absence rules, calendar monotonicity, canonical hashing) stay fixed; nothing in
this round touches them.

## Design laws for every option
- **Default = current behavior.** A program that declares nothing is byte-identical in
  every fixture. The only intended fixture movement is C1's GZCLP correction (below).
- **Declared, checked, described.** Each option is part of the program/registry IR,
  validated by the checker (bad values are typed refusals, new codes where needed), and
  its generated prose names the chosen behavior. An option the describer cannot phrase
  within the naming budget is a design failure; report it, do not ship mute config.
- **Options are facts of the program hash.** Changing one changes programHash; stamped
  prescriptions never re-derive under a new option value (same law as tmBumpTiming).
- **Grammar discipline.** Prefer option FIELDS and registry declarations (the weekbasis
  precedent: fields, not formers). A new former is allowed ONLY when no option-shaped
  design expresses the item; any such amendment gets its own ledger entry, checker rules,
  describer, negatives, and an explicit "GRAMMAR AMENDED" flag in the report.
- **Fail-first where behavior moves.** Any item that changes a worked program's numbers
  (C1) lands with the before/after shown against the pre-round freeze.
- **Every option ships at least one non-default fixture** exercising it through issue,
  judge, step, and prose, plus a negative (out-of-domain value refused).

## The items

C1. **Verdict success rule.** New per-slot (overridable per-policy) declaration
    `success: 'allSets' (default) | 'totalReps' | {atLeastSets: n}`. `totalReps` judges
    the summed reps across the slot's judged sets against the summed floor. `atLeastSets`
    hits when ≥ n sets hit. Interacts with three-valued verdicts: unknown propagates as
    today (a silent set makes totalReps unknown unless the logged sets alone already
    decide it, decidable-early in both directions). Correct the worked GZCLP library
    definition to `totalReps` per the method's published rule; its fixtures move and are
    listed with cause. Prose: "counts total reps across all sets" etc.
C2. **e1RM estimator.** Registry/program declaration
    `e1rm: {formula: 'epley' (default) | 'brzycki' | 'lombardi' | 'mayhew', maxReps?: n}`,
    attached at the PROGRAM (stall/TM math must be internally consistent), with per-read
    override on the event e1RM read. Out-of-domain reps (e.g. Brzycki ≥ 37, or > maxReps)
    produce a new typed absence cause `outsideFormulaDomain` absorbed by the existing Opt.
    The X6 unified RIR rule from the correctness round applies across all formulas.
    Prose names the formula: "estimated one-rep max (Brzycki)".
C3. **Adherence week alignment.** Calendar option
    `adherenceWeeks: 'fromAnchor' (default) | {calendarAligned: {weekStart: Weekday}}`,
    program-declared, instance-overridable (CalendarSpec seam). Affects ONLY adherence/
    frequency windows, never the progress clock. Prose split already exists ("7-day
    window from your start day" vs "calendar week, Monday to Sunday"); wire it.
C4. **Technique-stage volume weights.** Per-program
    `volumeWeights?: {stage?: number (default 0.5), cluster?: number (default 1)}`,
    consumed by the weekly sets read and trained-volume event read. Domain (0, 1] checked.
    Prose: "a drop-set stage counts as half a set".
C5. **Intensifier-strip roles.** Per-program `stripIntensifierOn?: WeekRole[]`
    (default ['deload','taper','test']). The dose law itself (one intensifier, final set)
    stays LAW. Checker refuses roles not in the program's calendar vocabulary (same
    literalDomain posture as X4).
C6. **Sink tie direction.** Per-program `ties: 'down' (default) | 'up'` beside `grids`,
    consumed by nearestStep's callers for `exact` bounds and `round nearest` only (the
    directional floor/ceiling law is unaffected). Per-PROGRAM only, never per-viewer
    (the issued number is a shared fact; all three reviewers concur). The rule is part of
    the program hash and stamped like everything else.
C7. **Lapse threshold per instance.** `lapseAfterDays` stays program-declared; the
    instance activation spec may override it (one argument through the CalendarSpec
    seam). Prose states the active value.
C8. **Fact staleness per program.** Registry `maxAgeDays` stays the default; a program
    may override per fact key (`staleness: {bodyweight: 30}`). Checker refuses overrides
    for fact keys the program never reads.
C9. **scaleSets allowZero.** Optional arg on scaleSets (default false, current refusal
    posture for factor > 1 from F12 unchanged): `allowZero: true` lets a deload transform
    drop a line to zero sets, issuing nothing for that line while keeping the slot judged
    as untrained-by-plan (NOT keep(untrained) which is a logging outcome; define and
    state the verdict interaction in SPEC: a zero-set planned line yields no judged
    verdict and no volume).
C10. **Library constants to params.** Sweep the scheme library (linearGated, gzclpT1,
    w531, deloadStd, endurance/rehab defs) for remaining numeric literals that are
    coaching choices rather than method identity; promote each to a declared param with
    its current value as default. Method-identity numbers (5/3/1's 65/75/85 wave is the
    method) stay literal; judgment calls (a backoff of exactly 10%) become params. List
    every promotion in the report.
C11. **Display unit per user.** Decide-and-implement at the PROJECTION layer only: the
    describer/projection takes a display-unit parameter (kg|lb per viewer); grids and
    issued numbers remain program facts in the grid's declared unit (F11). No engine
    state change; conversion is display-exact (stated rounding, never re-quantized
    against the grid). If this cannot be done honestly at the projection layer alone,
    report instead of moving units into per-user engine state.

## Out of scope
Effort-as-ceiling semantics (no reviewer converged on a shape; needs its own design
pass). Any change to the correctness round's X-items beyond consuming X6's RIR rule.

## Process
1. This round starts ONLY from the correctness round's landed tree (after X1-X6; the
   fix delegate's report and arena2/patfix-prefix.txt are inputs).
2. Freeze first: `cp -R arena2/synthesis arena2/synthesis-patfix` before the first edit.
3. Fail-first transcript for C1's GZCLP movement and every negative; save to
   arena2/config-prefix.txt.
4. verify.sh all 8 steps green; kit regenerated; changed fixtures listed with causes
   (expected: C1 only, plus ADDED non-default fixtures per option).
5. rationale.md gains a "Configurability round" section: per-item ledger, where each
   declaration lives (program/registry/instance/projection), prose samples, any GRAMMAR
   AMENDED flags, and the C10 promotion list.
6. SPEC gains a consolidated "Declared options" section so the Rust room sees one table.
