# Diet phase is an episode, not a flag on a block

Why the "Still cutting?" card cannot fire for the lifter it was built for, where
the state belongs instead, and why we ask rather than infer.

- Status: design decision / pending implementation
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

> Backoffs held on Squat and Bench 4 times over 9 weeks. Still cutting?

Buttons state the consequence, not the state change, matching `OvershootField`:

> **Still cutting — keep holding backoffs** · **Cut's over — resume automatic backoffs**

Card, not modal: this is a state refresh, not a destructive confirmation, and a
routine modal trains dismissal.

**Cadence.** Prompt at 8 weeks from `started_on` or `last_confirmed_at`,
re-prompt at +2 and +4, then **auto-close to `maintaining` at ~14–16 weeks with
a visible one-tap undo**. Back off on repeated confirmation rather than
escalating — the iOS background-location model, which also shows its evidence
before asking. Auto-close is safe because the failure is asymmetric: wrongly
ending a cut re-arms a rule the lifter can decline, wrongly leaving one open
disables safety logic indefinitely. Fail toward the observable state.

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

## 08 · Fix the copy regardless

`autoregulate.ts` currently says:

> Hold {load} — 3 stalls is expected while cutting and holding is the win.

The claim is not supported. The meta-analytic finding (Murphy & Koehler 2022)
is that an energy deficit impairs **lean mass** gains but **not** strength — so
strength is the resilient adaptation in a deficit, and three consecutive
failures to *add* load are expected while *losing* load is a warning sign. The
adjacent folk claim that reducing load during a cut is harmful is lore; a 10%
reduction leaves the lifter far above any intensity threshold where the
strength stimulus disappears.

The honest justification is a control-systems one, and it is stronger:

> While cutting we hold automatic backoffs — otherwise a normal flat patch
> ratchets your training max down for a reason that was never fatigue. Deload
> if sessions feel grindy.

This is the copy change to make even if nothing else here ships.

## 09 · What is thin

Stated plainly so nobody quotes this doc as settled:

- **No trial answers the load-bearing question** — whether a deficit changes
  the correct *response* to a stall, or only its expected *frequency*. Our read
  is "mostly frequency, plus the ratcheting argument". That is a judgement.
- **`3` has no evidentiary basis.** It descends from the Starting Strength
  reset convention and 5/3/1's TM reset. It is a reasonable Schelling point
  trading false positives against wasted weeks; keep it, but do not defend it
  as evidence.
- **The physiology citations were not re-verified** against primary sources
  when this was written. Check Murphy & Koehler, Garthe 2011, Longland 2016 and
  Helms 2014 before any of it reaches user-facing copy.
- **The app survey is weak.** We could not confirm whether RP Hypertrophy or
  Juggernaut AI branch training output on diet phase. The structural claim —
  that diet phase is universally modelled as a time-boxed entity and never
  inferred-then-applied-to-training — is a confident inference, not a survey.
- **Auto-close at 14–16 weeks is a judgement call** on asymmetric failure
  costs, not a researched pattern. Leaving the episode open and continuing to
  prompt is a defensible alternative.

## 10 · Order of work

The copy fix (§08) is independent and should land first — it is a string, and
the current one makes a claim we cannot support.

Everything else is one change: the episode table, a backfill from `diet_phase`
+ `diet_phase_set_at` (where the true `started_on` is genuinely unknown for
historical rows — prefer null-and-ask over a fabricated date),
`autoregulate.ts` reading the user's open episode, the staleness brain moving
off the program, and the card being rebuilt. Migrate before deploy.

This does not belong in a UI branch.
