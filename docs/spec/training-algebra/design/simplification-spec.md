# Simplification spec (fold round 3 → v3)

Source of authority: the language interrogation's Act-On verdict (three reviewers, two probe suites). Pre-fold snapshot frozen at arena2/synthesis-v2/. Amend arena2/synthesis/ in place. The evaluator itself is the NEXT phase (R2); this round shrinks and hardens the grammar the evaluator will target. Where a change makes a worked program or demo section stale, update it; nothing silently dropped.

## S1. Three-valued verdicts
Replace hitAll/missedAny with one event query `verdict(steps, bound): En<'hit'|'missed'|'unknown'>` (plus a per-step form if needed by the corpus). `match` exhaustiveness forces the unknown arm. Rewrite every worked handler; the two-way silence-punisher form must become INEXPRESSIBLE, not merely avoided. Keep a `completed` boolean only if some program genuinely needs it.

## S2. One patch outcome
Replace commit/propose/keep/both with a single patch record: `{ [field]: { to: Expr, mode: 'commit' | 'propose' } }`, keep = empty patch. Disjointness across same-trigger rules becomes a structural check over record keys (closes L4). Delete `both`. Describers render per-field mode ("proposes, for your OK").

## S3. Policy semantics
One conditional-transformer concept with a DECLARED hit policy on the program: `first | all-in-order`. Default all-in-order WITH composed prose: when two or more policies can co-fire (statically detectable overlap or always), the program description renders the composed result per combination ("in a deload week while stalled: 81% load, half the sets"), not independent sentences. One total application order, stated and checked: roles-sugar → allocation default → declared order → phase transform. Outcome-policy `when` evaluates against the event's stamped snapshot. `demotedBy` becomes a list. Refusal `roleDoubleEncoding`: a scheme plan reading pos.role under a program that declares a role policy for the same role.

## S4. One table former; cut iterate
`table(key, rows, overflow/hit)` subsumes schedule, bands, byLevel, mapLit+at. Key sort selects interpretation (clock index | ordinal/enum | ascending literal thresholds | ref). Thresholds must be literal and ascending (refusal otherwise); dead-row and unsorted bands die. `schedule(...)` survives only as embedding sugar lowering to table. Cut `iterate` (fold covers it). Keep sum/count/pick as formers (describers earn seats). `allocate` stays but its semantics get SPECIFIED in the former's doc comment as normative: greedy, one unit at a time, re-rank per unit explicitly stated true or false (pick one), ties by declaration order, clamp refused when `n` is a literal > max (refusal boundNotLiteral extension: `nExceedsMax`), trace-reported drops stay.

## S5. Single typing authority + IR hole closures
The IR checker is authoritative; the TS embedding is a builder whose phantom layer is best-effort (state this in rationale; negative.ts keeps proving TS-refused ⇒ IR-refused, and add the converse corpus: IR-accepted programs must TS-typecheck or be documented embedding gaps).
- Clock sorts: pos.* and cal.* reads get distinct SORTS, not just dimensions. No arithmetic may cross clock sorts; rate literals whose unit or per is a clock unit (d, wk) are refused (`clockRate`). cal.count vs pos.slotSession comparison refused (different sorts). Restate the two-clock law honestly in rationale: plans MAY read the calendar; no calendar-derived value may index a progress schedule or feed arithmetic with progress-clock values.
- Xforms typed by logging: session sort carries its logging set in IR (`Ty.session.logging`), swapExercise requires compatible logging or re-checks targets (refusal `loggingMismatch`), reshape/scaleMetric run metricNotLogged.
- Mixed-logging ladders: Ty.ref gains logging sets; ladder targets check against the INTERSECTION.
- Literal canonicalization: IR literals store canonical value + display unit at elaboration. kg+lb becomes one canonical addition that displays both. rpe literals lower to RIR at elaboration (affine removed from the unit table; rpe stays as input/display notation only).
- cmp on Opt reports absenceUnhandled (same teaching path as arith).

## S6. StateKind derived
Kind derives from the declared dimension (mass → load; sets → volume; everything else → plain). The six-way label and its default die. Cut-law policies key on derived kinds only. The mislabel bypass (probe M4/probe7) becomes unwritable.

## S7. Prose honesty
- ProgramDef.says: renders ONLY for library programs; user programs get a generated headline (calendar + day/slot summary). D5's rationale text corrected.
- Non-library `named`/let nouns render with inline expansion at intent zoom ("your earned increment [2.5 kg per rep past 10]"); library nouns render bare.
- Precedence/bracketing: describers emit the Phrase tree with structured nesting (lists/indentation for nested if, policy lists, orElse scope); the dangling-otherwise and or/and ambiguities die. Add a demo section exercising exactly the four probe ambiguities.
- Two clock vocabularies: progress prose says "block week / training week"; adherence prose says "7-day window (from your start day)" and never the bare word week for a tumbling window. dueText "not before" replaces fabricated due dates (time.ts fix S9).
- Budget: relabeled a readability lint in rationale (not a describability guarantee); match costed per row like byLevel; IR `let` requires a label (refusal), so budget boundaries and prose boundaries coincide; named nouns outside the library glossary charge 1 instead of 0.
- Ref labels: exercise/muscle labels resolve from a registry by id at describe time; author-supplied label mismatches are refused at compile (`labelMismatch`) or labels are simply dropped from the IR (pick the simpler; recommend: drop from IR, registry supplies).
- Fix the shipped wrong library template ("cuts the day to two sets") and the hard-coded "(after its deload)" clause (derive from calendar).

## S8. Calendar fixes
- lastOn takes max(existing, occurrence day); late logs can only extend, never regress gaps.
- Elaborated.reads collects cal.gap/recent selectors; lastOn is maintained for every selector the program reads, not just frequency selectors. A read of an untracked selector is impossible by construction.
- dueVerdict: `{k:'notBefore'}` when the horizon search fails; prose "not before {day}".
- within(): canonicalize selector sets (sort) before containment.
- The grid field becomes per-metric (`grids: {load?: .., distance?: ..}`), optional; no more "1 kg load grid" on a running program.

## S9. Small closures
- fact keyed by slot refuses muscle refs.
- OutcomeRule kinds naming no existing field: refusal.
- Index bases stated once in rationale (0-based everywhere except occurrence, which is renamed or rebased; pick 0-based and rename prose accordingly).
- Add `range(n)` (literal n) as a key list for tabulate (kills 12-row hand-typed waves). [Consider-promoted: cheap, unlocks real authoring pain found by B]
- Rationale gains: the day-selection trust boundary law (the shell proposes the day; the rotation's next unmet day is the default; mismatch recorded), and the embedding-drift risk note.

## Verification obligations
1. tsc strict clean; verify.sh green end to end.
2. negative.ts updated: the S1 two-way-handler form inexpressible (old negatives rewritten), both gone, clockRate, loggingMismatch, nExceedsMax, unlabeled let, labelMismatch (if kept), threshold-order refusals firing; converse corpus added (IR-accepted ⇒ TS or documented).
3. Demo updated: policy stacking section shows the COMPOSED prose; the four ambiguity probes render unambiguously; verdict three-way in every handler; table former in the 5/3/1 and APRE programs; range(n) wave example; notBefore verdict; lastOn late-log case corrected in the frequency demo.
4. Former/construct count reported before/after in rationale (target: net reduction despite range(n)); refusal count updated.
5. rationale.md: reconciliation per S-item, corrected claims (D4 lint, D5 gating, two-clock law), the two new laws' wording, carried open items (unified read former and allocate-as-fold deferred to R2 with reasons).
