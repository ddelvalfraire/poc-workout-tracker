# Correctness fix spec (post dual interrogation: correctness + paternalism)

Source reviews: patrev-a/ (opus), patrev-b/ (fable), patrev-c/ (sonnet). Their probe
files are the reproduction suite and BECOME regression tests. The parent adjudicated
the one conflict by running the probes: A's p1-anchored-batch.ts shows batched vs
daily dayClosed divergence on an anchored calendar (daily emits week:a:0, batched
emits nothing); B's probe4 passes only because it never uses an anchored calendar.
Both probes are correct; the bug is real.

Scope law: correctness ONLY. The grammar stays frozen at 47 formers. NO
configurability item from the paternalism sweep lands here (those are owner
decisions, pending). If a fix would require a grammar change, STOP and report.

## Process
1. Freeze first: `cp -R synthesis synthesis-weekbasis` (the pre-fix snapshot).
   All work in place in `synthesis/`.
2. Every X-item lands with a probe-derived regression test shown FAILING against
   synthesis-weekbasis first; transcript saved to `arena2/patfix-prefix.txt`.
3. `verify.sh` all 8 steps green at the end; fixtures regenerate; every changed
   fixture listed with its cause.
4. rationale.md gains a "Correctness interrogation round" section with the X
   ledger; decisions marked OWNER-OVERRIDABLE where noted.

## Criticals
X1. ports.ts aggPort.measured(): the `roleOf(def, week) === null → noUpcomingWeek`
    absence return currently runs for EVERY weekly read. Gate it to
    `basis === 'upcoming'` only. A closing/default read at role===null keeps the
    pre-round `?? 'train'` behavior (a DEFAULT weekly read is typed plain
    Q<'sets'>; it must never produce a none — that is the exact F1 shape).
    Raised by A, C (both probed the evaluator crash: a `once` program past its
    end, default weekly read → "expected a quantity, got none"); B independently
    flagged the same lines as a type-soundness hole with a mislabeled cause.
    Regression: default weekly read at week == len of a `once` program evaluates;
    upcoming read there still returns typed absence noUpcomingWeek.
X2. step.ts dayClosed: per-day side effects are applied from the LAST day's state
    (one withStatus, then the anchored loop gated on the final status). Rework to
    one per-day loop: for each newly closed day in order — close the day, fire
    that day's periodClosed, run the anchored week-close check against THAT day's
    post-close state. Batched and daily delivery must be indistinguishable (law
    L5 replay determinism). Raised by A (patrev-a/p1-anchored-batch.ts is the
    failing probe, verified by the parent); port it as the regression plus a
    property-style check (random split points of the same day range ⇒ identical
    terminal state and emitted closes).
X3. structure.ts WeeklyOf<T,O> embedding typing: plain Q only when the options
    are provably default; a widened/unknown options type must type as Opt, and
    IR-accepted `known(...)` handling must typecheck (the converse direction).
    Raised by A and C (C probed both directions). Regression: type-level tests
    both ways (tsd-style expect-type or @ts-expect-error pairs) in the embedding
    suite.

## Warnings fixed in this round
X4. Checker: a `roles` list disjoint from a KNOWN calendar's role set is refused
    (literalDomain), not silently dead. (A W4; probe p5-roles-disjoint.ts.)
X5. Lapse after a bounded pause: the instance reads `active` for one day after
    the pause ends, then re-lapses. Fix the pause-end/lapse interaction so the
    status is consistent the day the pause ends. (A p7-lapse-launder.ts, C
    agreed.) B's probe4 lapse arithmetic must stay green.
X6. e1RM internal consistency: the event-path e1RM ignores logged RIR while
    loadFor's inverse includes it, so a round trip disagrees. Make the two
    consistent under ONE stated rule, recorded OWNER-OVERRIDABLE (the formula
    CHOICE itself — Epley vs Brzycki etc. — is a pending owner configurability
    decision and must NOT be implemented here; only the RIR treatment is unified).
    State the rule in SPEC 3.3 beside the F6 absence rules.

## Documentation-only (same round, no semantics change)
D1. SPEC/rationale state the `upcoming` stance explicitly: it advances pos.week
    only; slotSession and cal.* are measured at today's values; across a
    cycleEnd/phase boundary it does NOT see the pending TM bump; for a cycling
    calendar inside a bounded macro it measures the same program's next week.
    (B W2, B N1, A W1.) If the describer says "planned in the coming week" where
    a boundary bump is pending, soften the sentence to match (prose honesty law).
D2. Closing-basis prose: stop claiming "got in the week just ended" where the
    read re-plans under post-week state; say what it measures (planned-under-
    current-state × nominal sessions). (A W2.) Prose change only; if an honest
    sentence needs data the port lacks, report instead of inventing.
D3. B N3 (duplicate static capture record) and N4 (sink-note trace node reuse):
    fix only if trivial; otherwise record as known nits in rationale.

## Explicitly OUT of scope (owner-pending configurability)
e1RM formula choice, verdict success rule, adherence week alignment, display
unit/plate grid per user, fact staleness per program, technique-stage volume
weights, volume-set counting, scaleSets allowZero, effort-as-ceiling, strip
roles, sink tie direction, lapse per-instance override, library constants→params.
