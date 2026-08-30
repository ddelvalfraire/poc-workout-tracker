# Auto-regulating Techniques

How the engine should score rest-pause work — the one technique whose
progression rule is both canonical and expressible here — why the other three
stay silent, and what the lifter has to be told, because a rule nobody can see
reads as a bug.

`docs/TECHNIQUE-LOGGING.md` settled that no row of a technique group testifies
to auto-regulation, and left "total-reps progression" open. This is that.

- Status: draft / codebase-verified + sourced / no implementation
- Date: 2026-08-27

## 01 · Why the current silence is right, and not enough

The exclusion is one predicate — `isNull(sets.techniqueKind)`
(`src/db/autoreg-history.ts:214`) — and its reasoning holds: these methods are
failure work by design, so a per-set rep FLOOR reads the technique working as a
missed target, and the engine would back the load off for succeeding.

But silence has a cost the doc did not price. A DC-style program is rest-pause
on every exercise. Such a program gets **no verdict, ever** — no stall
detection, no load adjustment, no early-deload flag — and nothing in the app
says so. The lifter is running the one style of programming that most depends on
a progression rule, on an engine that has quietly opted them out.

Silence was the right holding position. It is the wrong resting position.

## 02 · What the methods progress on

Researched per kind. The column that decides everything is the third one:
a rule can be canonical and still be unusable, if it progresses on an axis this
engine does not have.

| Kind | The rule the sources define | Expressible here? |
|---|---|---|
| **Rest-pause (DC)** | Total reps across the group, banded 11–15. "Beat the logbook": next session take more total reps at the same load, or the same reps at more load. Failing three times means the EXERCISE is stale — rotate it, don't drop the weight | **Yes** |
| **Myo-reps** | Complete all N mini-sets → add **one rep to the activation set**. Don't complete them → repeat the session unchanged | **No** — it advances a REP TARGET; this engine advances loads |
| **Cluster** | No canonical session-to-session rule. The literature is about acute effects (fatigue, power maintenance, EMG), and where it treats progression it is by **manipulating intra-set rest**, not load or reps | **No** — `restSec` is authored, never auto-regulated |
| **Drop set** | None. General advice ("add weight when you complete all sets in good form"), which is just double progression and says nothing specific to dropping | **N/A** — nothing to express |

So exactly one of the four has a rule that is both canonical and expressible.
That is the scope.

## 03 · The rule: rest-pause only

> Two earlier scopings of mine were wrong, in opposite directions. The first —
> "rest-pause and drop sets" — included the kind with the weakest evidence. The
> second replaced it with a general "completion" rule covering myo-reps, cluster
> and drop sets. That rule is not in any source: I generalised it. For myo-reps
> it actively contradicts the canon, which advances a rep target rather than a
> load. It is removed.

**The rule.** A rest-pause group collapses to one virtual scorable set: `reps` =
the group's total across every stage, `load` = the top set's prescribed load.
That virtual set goes through the EXISTING rules unchanged. This is not a new
engine — RANGE mode already scores total-rep-gain over comparable sessions
rather than floor misses (`src/lib/programs/autoregulate.ts:49`), and DC's 11–15 band is
literally a rep range. A rest-pause group is double progression whose unit is a
group.

**Everything else stays silent**, and now for a stated reason rather than a
blanket exclusion:

- **Myo-reps** — we can detect its trigger (all mini-sets completed) but cannot
  act on it, because the canonical response is "+1 rep on the activation set"
  and this engine adjusts loads. Scoring it as a load advance would be inventing
  a rule the method does not have. It becomes scorable when rep-target
  advancement exists; that is a feature, not a guess (§08).
- **Cluster** — the method's progression axis is intra-set rest, which is
  authored and never auto-regulated. There is no load rule to apply.
- **Drop set** — no canonical rule exists. Silence is the honest reading of the
  evidence, not caution.

**The rule may not lower a load.** Backing a lifter off for reaching failure in
a method designed to reach failure is the corruption the current silence exists
to prevent. A rest-pause group may advance a load, hold it, or say nothing.

### The "stale" case belongs to proposals, not to loads

DC's own answer to three sessions of not beating the logbook is to rotate the
exercise. That is a substitution, and we have the machinery: a patch proposal
the owner confirms, never an automatic write.

**This is not free.** `substitute_program_exercise` is absent from
`PROPOSABLE_PATCH_TOOLS` (`src/lib/programs/patch-proposal.ts:26`) — today only set ops,
the training max and the diet phase are proposable. Adding it widens what the
engine may propose, and it should land as its own change with its own review,
not folded into a scoring PR.

## 04 · `loadPct` is a precondition, not a coincidence

Group totals are comparable across sessions only if the group's difficulty is
stable. With absolute stage loads (`docs/specs/technique-authoring.md` §02), a
drop set gets relatively lighter every week as the top set progresses — 80 kg is
−20% off a 100 kg top set and −30% off 115. Total reps would climb for a reason
that is not the lifter improving, and the rule would read progress that never
happened.

**Ordering is therefore fixed:** `loadPct` ships before any group scoring does.
A percentage stage holds the group's shape constant, which is what makes its
total mean anything.

## 05 · The engine work

Small, because the seam was left deliberately.

1. **`AutoregHistorySession.sets[]` gains `techniqueGroup` and `stageIndex`**
   (`src/db/autoreg-history.ts:29`). Both columns already exist on `sets`
   (`schema.ts:211`) and are already stamped at derivation
   (`db/prescriptions.ts:689`). Additive interface change.
2. **The predicate stops excluding and starts grouping.**
   `isNull(sets.techniqueKind)` comes out; rows arrive carrying their group, and
   a fold collapses each group into its virtual set before the rules see it.
3. **Kind gates the rule** — the one place `kind` stops being a label. Only
   `'rest-pause'` scores; the other three fold to a non-event carrying their
   reason (§06 D1).
4. **No schema change, no migration.** Every input already exists.

Guardrail, restated from the autoreg design decisions: prescriptions are
snapshotted facts, and silence beats a wrong verdict. A group whose stages lack
the snapshot needed to judge them scores as a non-event.

## 06 · What the lifter must be told

A correct rule the lifter cannot see is indistinguishable from a broken one.
Three disclosures, in descending order of how badly their absence hurts.

**D1 — Why this exercise has no verdict.** Today an exercise carrying a
technique shows nothing, and nothing distinguishes "the engine has no opinion
yet" from "the engine has opted this exercise out". Non-events exist both before
and after this spec, so the reason line (`autoregReason`, already rendered
quietly and volt-free on the program detail page) needs a technique case: what
is being watched, and what would move it.

**D2 — What "beat the logbook" needs, in this session's numbers.** The rule is
only actionable if the lifter knows the target *while training*. A rest-pause
group should carry its total-reps line in the logger — last session's total, and
this session's running total as stages are logged. The number IS the
progression; it should not have to be worked out in the lifter's head.

**D3 — What authoring a technique changes.** From
`docs/specs/technique-authoring.md` §04, adding a technique changes the scoring
contract for that exercise. Under this spec it changes a second time — from
silence to a group rule. That belongs at the point of choosing, one sentence per
rule, not in a help sheet.

If any of the three cannot be stated in a sentence the lifter would recognise,
that is evidence the rule is wrong, not that the copy is hard.

## 07 · Test anchors

- A rest-pause group totalling 11 reps at load X, then 12 at X, is progress —
  not three stalled rows.
- A rest-pause group never produces a load decrease, however many stages missed
  their reps.
- A myo-reps, cluster or drop-set group is a non-event: the load neither advances
  nor backs off, no stall streak increments, and the reason line says which of
  the two silences it is (§06 D1).
- A cluster group counts 1.0 toward volume (unchanged) while scoring nothing —
  volume weighting and auto-regulation stay independent.
- An exercise mixing ordinary and rest-pause sets: the ordinary sets still
  testify exactly as today, and the group is scored separately.
- A rest-pause group whose stages carry absolute loads under a progressing top
  set does NOT silently accumulate rep gains — §04's ordering makes this
  unreachable, and the test pins it.
- Byte-identical verdicts for every technique-free program, before and after.

## 08 · Out of scope, and open questions

### Out of scope

- **Adding `substitute_program_exercise` to `PROPOSABLE_PATCH_TOOLS`** — §03's
  stale path needs it; it is its own change.
- **The early-deload flag (M4) for technique work.** Its scoring is per-set floor
  based; whether a group total should feed it is a separate question.
- **Total-reps history and charting.** Scoring uses group totals; showing their
  trend is a history-surface change.

### Open questions

- **Is the DC band (11–15) ours to hardcode?** Canonical for DC, arbitrary
  elsewhere. Spec position: the band is authored per exercise — it is just a rep
  range on the virtual set — never a global constant.
- **Rep-target advancement.** Myo-reps is blocked on it, not on judgement: the
  method's canon is "+1 rep on the activation set", and the engine has no way to
  advance a rep target. Building that unblocks a canonical rule; until then,
  scoring myo-reps means inventing one.
- **Is intra-set rest a progression axis we want?** Cluster progression runs on
  it. Adding it would mean auto-regulating `restSec`, which nothing does today,
  and it is a larger question than techniques.
- **Does the "stale" rotation need three failures, or is DC's number ours to
  tune?** The source says rotate when you cannot beat the logbook; three is our
  existing stall-streak convention, not DC's.

## 09 · Sources

- Liftosaur, [DoggCrapp program](https://www.liftosaur.com/programs/doggcrapp)
- Arvo, [DC Training: 3-way split, rest-pause](https://arvo.guru/resources/methods/dc-training)
- StrengthLog, [Myo-Reps](https://www.strengthlog.com/myo-reps/)
- Barbell Medicine, [Myo-Reps](https://www.barbellmedicine.com/blog/myo-reps/)
- NFPT, [Drop Sets for Growth](https://www.nfpt.com/blog/drop-sets)
- PowerliftingTechnique, [Cluster Sets: What Are They? How To Use?](https://powerliftingtechnique.com/cluster-sets/)
- HMMR Media, [A comprehensive guide to cluster set training](https://www.hmmrmedia.com/2026/03/a-comprehensive-guide-to-cluster-set-training/)
- Tufano et al., [Cluster sets: performance maintenance and training-induced fatigue](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11667556/)
