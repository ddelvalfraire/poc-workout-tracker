# Configurability fix spec (post three-reader interrogation of the config round)

Union of cfgrev-a/ (opus), cfgrev-b/ (fable), cfgrev-c/ (sonnet). The parent re-ran the
decisive probes (cfgrev-b/probe.ts): all confirmed. Standing owner directives govern:
objectively correct per the laws, and configurability means user power, never silent
engine opinion. Decisions below are set under those directives, each owner-overridable.
Probes become regression tests. The grammar stays frozen at 47 formers.

## Criticals

Y1. **totalReps counts all logged judged sets, matching its prose** (B-C1-1, parent-
    verified; C-W9 is the companion semantics ruling). judge.ts verdictOf: under
    totalReps the floor is the summed per-set floors of the EXPECTED sets (range counts
    use count.min), and the credit is the summed logged reps of EVERY logged judged set
    of the slot, including make-up sets beyond the expected count. hit as soon as credit
    ≥ floor. missed only when every expected set is logged AND credit < floor and no
    further logged sets rescue it. unknown otherwise. Pooling across the slot's judged
    steps is the DOCUMENTED meaning (GZCLP's published rule lets later sets make up
    reps); SPEC 3.4 states both the pooling scope and the early-decidability rule
    honestly (hit early; a miss needs the expected sets logged). Regressions: B's P2
    ([3,3,3,3,3] on 3-5× exact-5 = hit), P2b ([3,3,3,2,2,3] on 5× exact-5 = hit),
    C's cross-step case pinned as documented-hit.
Y2. **atLeastSets cannot be unsatisfiable, and silence is never a miss** (A-1, B-C1-2,
    C partial; parent-verified via P1/P1b). Statically: where the plan's judged-set
    count is literal, n > count is refused (literalDomain, the X4/C5 posture).
    Dynamically (deload scaling, count ranges): n is capped at the judged sets actually
    issued, so an all-hit session hits. Nothing logged stays unknown, never missed.
    Regressions: P1 (nothing logged = unknown), P1b (3/3 hit under n=5-capped = hit),
    A's p3 deload case.
Y3. **The five redefined library definitions are republished as @2** (A-2, C-W6;
    B nit'd it but its own report names the standing hole). lib/gzclp-t1,
    double-progression, 531-jokers, hr-tempo, pain-gated-loading each get @2 carrying
    the round's changes; @1 bodies are restored to their pre-round content; corpus
    programs rebind to @2 so their hashes move HONESTLY. Immutability of published
    versioned definitions is reasserted in SPEC as law. The known hole (programHash
    covers ProgramDef only; a def edit is invisible to it) is recorded beside EC-212
    (content hashing of elaborated defs), not solved here.
Y4. **One form per meaning is ENFORCED for every option** (A-4, B-LAW-1, C-W1).
    The checker refuses explicit-default spellings everywhere the ties refusal already
    does: e1rm {formula:'epley'} alone, volumeWeights entries equal to their defaults
    (and {}), staleness entries equal to the registry value (and {}), strip lists equal
    to the default set, defaults:{}, allowZero:false (already), instance overrides equal
    to the program value. Set-valued options get ONE canonical spelling: duplicates
    refused, order pinned to the calendar's role declaration order (stated in SPEC).
    The TS embedding canonicalizes to the same forms. Structural fix mandated by all
    three reviewers: ONE options table (per option: default, canonicalize, check,
    describe) consulted by checkdefs/checker/describers/kit-schema, deleting the three
    copied formula lists, the duplicated success-rule check, and the scattered default
    constants (structure.declaredOptions, issue.STRIP_ROLES, ports weights, judge
    'epley'). This fixes Y4 by construction.
Y5. **ties (and display) thread through every context builder** (A-3, C-W3, B-C6-1).
    evaluate.ts app callee ctx, ports.slotParams, project.ts handoff and gate ctxs, and
    issue.setsDue (its caller has issued.stamp in scope) all carry ties/display.
    SPEC 7's C6 row then holds with no exception. Regression: A's p4 fn-call round
    (102.5 via function in a ties-up program) and a setsDue until-condition case.

## Warnings fixed in the same round

Y6. **e1rm skips out-of-domain sets instead of vetoing the read** (A-5, B-C2-1, C-W5).
    A set with effective reps over the formula's domain or the declared maxReps is
    SKIPPED; the estimate comes from the qualifying sets; absent (outsideFormulaDomain
    naming the best offender) only when NO set qualifies. The prose's "from sets of at
    most N effective reps" becomes true. maxReps > the formula's domain is refused
    (brzycki 40). The absence/prose names the PROGRAM's cap when maxReps caused it,
    the formula when the domain did. Read-level formula override: state in SPEC that
    maxReps stays program-level (or thread an override; delegate picks the simpler
    honest one and states it).
Y7. **The declared formula actually governs the program's math** (A-6, C-W4, B-C2-2).
    lib/load-for becomes formula-aware (reads the program's declared formula through
    the same seam the e1rm read uses), so seeding/TM math uses the declared inverse and
    the X6 round-trip law holds for every formula. A program declaring e1rm but never
    reading ev.e1rm AND never calling load-for is refused (the C8 unread posture).
Y8. **A read can override back to allSets** (C-W2). The verdict read's success field
    accepts 'allSets' explicitly; "the read wins" becomes true in both directions.
    A slot-level success that no read can ever consume is flagged like dead staleness.
Y9. **Instance overrides are durable, typed, and spoken** (A-7, C-W8, B-C7-1).
    Overrides (lapseAfterDays, adherenceWeeks) are recorded on the instance record in
    the head (replay without the activation call still sees them); expectation keys
    cannot collide across alignments (window geometry derives from the recorded spec).
    Bad overrides are typed refusals, not thrown Errors (calendarSpecOf's throws
    converted; recorded throws fixtures regenerated as refusals with cause). Prose:
    the spec-consuming surfaces (adherenceText, dueText, and an instance lapse line)
    state the ACTIVE values; describeProgram keeps the program's declared ones.
Y10. **Refusal holes closed** (C-W10, B). stripIntensifierOn non-array, e1rm null,
    and every option position tolerate malformed JSON with a typed refusal, never a
    raw TypeError from forEach. atLeastSets non-integer already refused; keep.
Y11. **Prose repairs** (A-11, C-W7, B nits). Default programs regain the "8-12 reps"
    compaction (zero prose movement for non-declaring programs vs pre-round, verified
    against synthesis-patfix prose fixtures). Promoted C10 params carry a display
    label in their declaration; the "(with ...)" append uses labels, never internal
    identifiers. The ties-up parenthetical renders once per session line, not per grid
    entry. volumeWeights {} can no longer render "Volume counting: ." (dies with Y4
    anyway; keep a guard). describeProgram does not crash on refused IR (A-14): it is
    documented as defined only over checked programs, and the two probe cases refuse
    at check instead.
Y12. **allowZero scales the whole count range** (A-13). min and max scale together;
    a line whose max stays ≥ 1 while min hits 0 cannot exist (either the line is gone
    or it is a real range with min ≥ 0 judged as a range). State the judged meaning.

## Harness
Y13. verify.sh step 8 writes the kit to a per-run directory (or takes an flock) and
     syncs ../../handoff only on success, so concurrent runs cannot race each other
     into ENOENT (observed by all three reviewers).

## Explicitly deferred to the owner (do NOT implement)
- Extending C11 viewer units beyond sessionText to every prose surface (scoped work;
  ledger the current reach honestly where mixed units show, per A-8's kg-beside-lb
  example: state the limit in SPEC).
- Content hashing of elaborated defs (EC-212, seam prerequisite, already tracked).

## Process
1. Freeze first: cp -R arena2/synthesis arena2/synthesis-config. Work in place.
2. Every Y-item: probe-derived regression shown failing against synthesis-config
   first; transcript to arena2/cfgfix-prefix.txt (script, like patfix-prefix.sh).
3. verify.sh fully green; kit regenerated; every changed fixture listed with cause
   (expect real movement from Y3 rebinding to @2 and Y11 prose restoration; Y11's
   restoration should RETURN default-program prose to the patfix round's bytes).
4. rationale.md "Configurability fix round" section: Y ledger, the Y1/Y6/Y7 semantic
   decisions marked OWNER-OVERRIDABLE, the one-form canonical spellings, the @2
   republication record.
5. SPEC 3.4, 7 updated; the section-7 table stays the single source for the Rust room.
6. If any Y-item needs a grammar change beyond option fields: Y8's read-level
   'allSets' value is EXPECTED to be a field widening, not a former; anything larger,
   STOP that item and report.
