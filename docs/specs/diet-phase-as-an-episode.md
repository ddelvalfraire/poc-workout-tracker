# Diet phase: fix what it does, then where it lives

The suppression rests on a premise the evidence does not support; the flag is
also in the wrong place and cannot fire for the lifter it was built for. Both
are fixable, and the first one matters more.

- Status: §08 implemented (the deficit stall response is a volume cut, and
  the copy no longer asserts "3 stalls is expected"); §01–§07 pending — the
  episode table, its backfill and the card rebuild are the separate change.
- Date: 2026-08-27
- Depends on: autoregulation (`lib/autoregulate.ts`), the program detail page,
  `lib/diet-phase-staleness.ts`
- Extends: `docs/specs/program-policy-surfaces.md` — that doc's `dietPhase` row
  records where the control lives; this one argues its scope is wrong.

## 01 · What the flag does today

`programs.diet_phase` (`'cutting' | 'maintaining' | 'bulking'`) plus
`programs.diet_phase_set_at` are columns on the PROGRAM table. Under
`'cutting'`, `autoregulate.ts` gates the three-stall backoff: the adjustment is
computed as usual, tagged `phaseContext: 'cutting'`, and its application is
HELD rather than applied. The verdict becomes a hold instead of a load cut.

So the flag does not annotate the plan. It **disables a safety rule**, silently
and indefinitely, for as long as it is set.

`lib/diet-phase-staleness.ts` exists to bound that: after `CUT_STALE_WEEKS = 8`
the detail page shows a card asking "Still cutting?", with two writes and no
dismiss — because a dismiss would leave the stale flag in place, which is the
bug.

## 02 · The card cannot fire for the lifter it protects

Two facts, both in the code today:

- **A restart drops the phase.** `programs.ts` copies every other program
  setting to the new block and deliberately excludes `dietPhase` /
  `dietPhaseSetAt`, with the comment: *"a phase is a fact about the lifter's
  CURRENT diet, not about the plan."* The new block starts phase-less.
- **Every explicit write re-stamps the anchor.** `program-patches.ts` sets
  `dietPhaseSetAt: new Date()` on each phase write.

Together: a lifter cutting across sequential blocks re-declares the phase at
every block boundary, and each re-declaration restarts the eight-week clock at
zero. **Run six-week blocks and the timer never reaches eight.**

A twenty-week cut run as one entity per block — the shape this app's own
programs actually take — is precisely the case where a forgotten flag does the
most damage, and precisely the case the timer structurally cannot catch. The
staleness feature works only for someone who cuts inside a single long block,
which is the person who least needs reminding.

The schema comment already contains the diagnosis. The phase is a fact about
the lifter. It is stored on the plan.

## 03 · Three more things the current shape cannot express

- **Retroactive correction.** "I actually stopped cutting three weeks ago" is
  unrepresentable. `diet_phase_set_at` records when the row was written
  (transaction time) and is being asked to stand in for when the phase began
  (valid time). Correcting one destroys the other.
- **History.** "Was that PR set during a cut?" needs the phase at that instant.
  Flipping a mutable enum retroactively rewrites the phase of every past
  session in that program. Stall detection re-reads history, so this is a
  correctness question, not only an analytics one.
- **Concurrency.** Two programs can hold contradictory claims about one body.

## 04 · Decision

**Diet phase becomes a user-scoped episode with a start and an end.**

```
diet_phase_episode
  user_id
  phase              'cutting' | 'maintaining' | 'bulking'
  target_rate_pct_per_week  numeric | null  -- see 08a; Garthe's 0.7 vs 1.4
  started_on         date          -- valid time; user-editable
  ended_on           date | null   -- null = ongoing
  source             'declared' | 'confirmed' | 'auto_closed'
  recorded_at        timestamptz   -- transaction time
  last_confirmed_at  timestamptz | null
```

One open episode per user (partial unique index on `user_id where ended_on is
null`); overlaps prevented by an exclusion constraint on the date range.

This is the shape every domain that has hit this problem converged on. FHIR
models care as `EpisodeOfCare` with a `period` and a `statusHistory`
specifically so "what was the status on date X" is answerable without replaying
resource history. EHR **pregnancy status** is the closest analogue and the most
instructive: the stale-flag problem is a recognised patient-safety failure mode
there, and the field's answer was not a better reminder — it was to replace the
flag with an episode. Kimball would call the current column a Type 1 dimension
(overwrite, history destroyed) doing a Type 2 job.

Full bitemporality is NOT warranted. `recorded_at` alongside a user-editable
`started_on` is enough; we have no requirement to reproduce a past decision for
audit, and the migration cost is real.

**The training policy stays separable.** If a block should ever ignore the
lifter's phase, that is a nullable per-program override on top of a user-level
fact — not a reason to keep the fact on the program.

## 05 · We ask. We do not infer.

The tempting move is to read the phase off bodyweight, which we already log.
It is wrong, for a reason that is specific rather than general:

**The decision to automate is "has the cut ENDED" — and a flat weight trend is
not evidence of maintenance.** It is equally consistent with a stalled deficit
(metabolic adaptation), a recomposition, or water masking a real loss.
Inference is at its weakest exactly on the transition it would be used to
detect, and strongest on "still cutting", which needs no help.

Three supporting facts:

- **The data mostly is not there.** In a 10,000-user smart-scale cohort, the
  mean was 2.8 weighings per week, and 72.5% of self-weighers had at least one
  break of ≥30 days. Those are people who own smart scales; ours log manually
  in a lifting app.
- **Intent is not in the data.** MacroFactor has weight *and* intake *and* an
  adaptive filter, and still asks the user their goal. The state of the art
  infers the quantity and asks the intent.
- **Silent wrong inference is worse than a question.** Reading a refeed weekend
  as the end of a cut re-arms the backoff and cuts the training max during a
  diet — the exact harm the feature exists to prevent — with no explanation the
  lifter can see. The current design's worst case is a card once every eight
  weeks. The costs are asymmetric; ask.

This also keeps `autoregulate.ts` reading one field. Weight may touch the
*prompt*; it must never touch the *decision*. Our standing rule that autoreg
prescriptions are snapshotted facts and never re-derived points the same way.

## 06 · The prompt

Evidence-led, and **the evidence comes from training data, not bodyweight** —
which is 100% covered by definition, is the thing actually being suppressed,
and couples nothing:

> Volume trimmed instead of load on Squat and Bench 4 times over 9 weeks.
> Still cutting?

Buttons state the consequence, not the state change, matching `OvershootField`:

> **Still cutting — keep protecting load** · **Cut's over — back to normal progression**

Card, not modal: this is a state refresh, not a destructive confirmation, and a
routine modal trains dismissal.

**Cadence.** Prompt at 8 weeks from `started_on` or `last_confirmed_at`,
re-prompt at +2 and +4, then **auto-close to `maintaining` at ~14–16 weeks with
a visible one-tap undo**. Back off on repeated confirmation rather than
escalating — the iOS background-location model, which also shows its evidence
before asking. Auto-close is safe because the failure is asymmetric: wrongly
ending a cut restores ordinary progression the lifter can see and correct,
wrongly leaving one open alters the engine indefinitely. Fail toward the
observable state.

**Bodyweight, if present, may only ever bring the prompt EARLIER** and add a
line to it — gated on real density (≥12 weighings in the last 28 days, and a
95% CI on the rate excluding −0.25 kg/wk). Below that it does not fire. Never
show a confidence-free number.

## 07 · Ramp back in, do not re-arm

**On any phase transition, reset the per-lift stall counters and phase the
backoff back in over ~2 weeks.** Re-arming at full strength means the first
post-cut stall — almost certainly refeed noise while glycogen returns —
triggers a load cut on a lifter who is about to start progressing again. This
is Oura's Rest Mode easing period, and the current design has no equivalent.

## 08 · The premise is wrong, so change the remedy — not just the copy

`autoregulate.ts` currently says:

> Hold {load} — 3 stalls is expected while cutting and holding is the win.

**"Holding is the win" is well supported. "3 stalls is expected" is not, and is
contradicted by the only trial that reports session-level load behaviour under
restriction.**

- **Murphy & Koehler 2022** (*Scand J Med Sci Sports*, PMID 34623696): an energy
  deficit impairs lean-mass gains (ES −0.57, p = 0.02) but **not** strength
  gains (ES −0.31, p = 0.28). Across 52 studies both conditions gained strength
  with near-identical effects (0.84 vs 0.81). Our stall detector keys on *load
  progression* — the variable a deficit affects least.
- **Roth 2023** (PMID 36114738): trained males, six weeks at 30 kcal/kg,
  **both groups continuously increased training loads**. There is no
  quantitative literature on stall frequency in a deficit, and the one direct
  observation runs the other way.
- **Spiering 2021** (PMID 33629972), **Bickel 2011** (PMID 21131862),
  **Mujika & Padilla 2000** (PMID 10999420): strength and size are maintained
  on as little as one session a week and one set per exercise — *provided
  relative load is maintained*. Volume is the disposable variable; **load is
  the protected one.**

A ~10% training-max cut attacks the protected variable. So the current
suppression reaches a defensible outcome by the wrong route: it mutes the
signal rather than acting on it.

**Decision: on a stall while the lifter is in a deficit, cut VOLUME, not load.**

That is what the maintenance literature actually supports, it is what Helms and
RP prescribe in practice, and it is strictly better than suppression because it
*responds* to the stall instead of ignoring it. Secondarily, **slow the
increment** during a declared deficit so fewer stalls are generated at all.

The copy follows from the mechanism rather than asserting physiology:

> While cutting we trim volume instead of cutting your load — load is the thing
> worth protecting. Deload if sessions feel grindy.

Keep the "deload only if grindy" clause verbatim. It re-routes the decision from
a *progression* signal (uninformative in a deficit) to a *fatigue* signal (still
informative), and it is the best-designed part of the current system.

### 08a · Rate is a better input than a binary flag

**Garthe 2011** (PMID 21558571) is the cleanest evidence in the area: elite
athletes losing at **0.7%/wk gained** lean mass and 1RM; at **1.4%/wk they did
not**. The outcome tracks the *rate of loss*, not the existence of a deficit.

So the episode carries `target_rate_pct_per_week`, and where the lifter has
enough weigh-ins to estimate an actual rate (§05's density gate), the stall
verdict can say the useful thing instead of the vague one:

> You've stalled three times and you're losing at ~1.2%/wk. Slow the loss before
> we touch the bar.

That is the diagnosis-before-programming order every coaching source teaches,
computed. **It is also the only place bodyweight earns a role: estimating a
rate the lifter has already declared, never inferring the phase itself.**

### 08b · The flagless alternative, recorded because it may be better

Stronger by Science's templates contain no diet vocabulary at all. They handle
the deficit with **asymmetric autoregulation**: the training max drops 5% below
the lower threshold but rises only 2% above the upper one. A cut self-corrects
downward faster than a surplus ratchets up, **without the system ever being told
a cut is happening** — no flag, no timer, no card, no coupling.

If we ever want to delete this whole surface, that is the shape to replace it
with. Recorded deliberately: it is the cheapest correct thing in the survey.

## 09 · What is thin

Stated plainly so nobody quotes this doc as settled:

- **No trial has ever compared "reduce load on stall" versus "hold load through
  stall"**, in a deficit or otherwise. §08's remedy is inference from adjacent
  maintenance/detraining work, not a direct test.
- **The weakest link in §08 is volume.** The maintenance literature is strong
  that volume is disposable and load is protected — but the *deficit* literature
  is genuinely contested. Stronger by Science found volume didn't meaningfully
  change body composition in a deficit; RP prescribes high volume precisely to
  retain muscle while cutting; Roth 2022 found studies that *increased* volume
  fared better. "Cut volume on a stall" is our best read, not a settled answer.
- **No quantitative data on stall frequency in a deficit exists at all.** The
  current copy asserts something nobody has measured.
- **`3` has no evidentiary basis.** It descends from the Starting Strength
  reset convention and 5/3/1's TM reset. It is a reasonable Schelling point
  trading false positives against wasted weeks; keep it, but do not defend it
  as evidence.
- **The physiology citations were not re-verified** against primary sources
  when this was written. Check Murphy & Koehler, Garthe 2011, Longland 2016 and
  Helms 2014 before any of it reaches user-facing copy.
- **The app survey found almost no prior art for coupling at all**, which cuts
  against the whole feature rather than just against inference. RP Hypertrophy —
  from the company that wrote the book on diet phases — has **no diet field
  anywhere**; its deloads are a pure timer. MacroFactor shipped a training app in
  January 2026 and **deliberately decoupled it**, sharing body metrics but no
  automatic program adjustments. Juggernaut's only nutrition→training link is a
  daily readiness check-in, not a phase. The one product claiming phase-aware
  training thresholds is a small indie app whose mechanism is undisclosed.
  Treat "should this coupling exist at all" as genuinely open.
- **Auto-close at 14–16 weeks is a judgement call** on asymmetric failure
  costs, not a researched pattern. Leaving the episode open and continuing to
  prompt is a defensible alternative.

## 10 · Order of work

**§08 lands first and is the highest-value change** — and it is more than a
string. The copy is unsupported, and the remedy behind it attacks the one
variable the evidence says to protect. Changing the stall response in a deficit
from a load cut to a volume cut is a small, self-contained engine change that
does not need the schema work.

Everything else is one change: the episode table, a backfill from `diet_phase`
+ `diet_phase_set_at` (where the true `started_on` is genuinely unknown for
historical rows — prefer null-and-ask over a fabricated date),
`autoregulate.ts` reading the user's open episode, the staleness brain moving
off the program, and the card being rebuilt. Migrate before deploy.

This does not belong in a UI branch.
