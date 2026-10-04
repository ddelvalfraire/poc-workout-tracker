# Corpus slice 4/6: endurance and cardio

Scope: running, rowing, cycling, swimming and conditioning programs, classified against the round-2 algebra (`arena2/synthesis`).

**Baseline.** The sibling adversarial review already recorded three fixes, and every classification below assumes they have landed:

- **(a) Cardio set fields.** The set record gains distance, pace and HR target fields.
- **(b) Repeat block.** A former for intra-session alternation, such as run/walk.
- **(c) Pace units.** Pace becomes a unit entry.

A program is NATIVE when it needs nothing beyond (a), (b) and (c). ONE-NODE names the extra former, query, input or unit it needs. The node ids (N1 to N7) are defined in "Patterns" below.

## How the current app logs cardio (read-only check)

- **Set mode.** Each set carries `metric_mode ∈ {reps_weight, duration, duration_distance}` (`src/lib/workout/workout-input.ts:54`, `src/lib/programs/program-input.ts:36`).
- **Columns.** `duration_sec integer` and `distance_m numeric(9,2)` live on `sets` (`drizzle/0003_absurd_wasp.sql:53-55`). Planned rows also carry them, including per-week `program_set_overrides` (`drizzle/0005_optimal_blur.sql:19-20`). That is a static week table, the same shape as `schedule('week', …)`.
- **Input validation.** A non-`reps_weight` planned set must have `durationSec` (`program-input.ts:346`).
- **No progression.** Autoregulation and plan-sync skip every non-`reps_weight` set (`src/lib/programs/autoregulate.ts:1478,1509`, `src/lib/programs/plan-sync.ts:250`).
- **Missing fields.** There is no HR, pace, power, calories, zone or lactate field anywhere. `logging_type` (`weight_reps | bodyweight_reps | weighted_bodyweight | assisted_bodyweight`) has no cardio member.

So today cardio is logged quantity with no prescription intelligence. The two existing columns map directly onto the work spec described below (duration becomes a `timed` work spec, distance becomes a `distance` work spec). Nothing is lost in migration.

## Catalog

| # | Program | Source | Progression rules in plain words | Classification | Evidence | Hardest feature |
|---|---|---|---|---|---|---|
| 1 | **Couch to 5K (NHS)** | [NHS plan](https://www.nhs.uk/better-health/get-active/get-running-with-couch-to-5k/couch-to-5k-running-plan/), [week by week](https://healthwell.eani.org.uk/healthtopic/get-fit/couch-5k-week-week?type_1=1) | 9 weeks, 3 runs a week. Each run is a 5-min brisk walk, then a run/walk pattern that changes each week: W1 is 1:00 run / 1:30 walk for 20 min. W3 is 2× (1:30 run, 1:30 walk, 3:00 run, 3:00 walk). W5 has three different days, ending in a 20-min continuous run. W7–9 are continuous 25/28/30-min runs. "Repeat any week until ready." | **NATIVE** | The plan is a ladder: a `List1` of 27 sessions indexed by a `rung` state field, exactly like `lib/stab-ladder`. The rung goes up by one per completed session, and `writableBy: ['session','owner']` makes "repeat the week" an owner write. Heterogeneous blocks come from (b). | Each week has a different block shape (heterogeneous repeat blocks). The clock is sessions completed, not calendar weeks. |
| 2 | **Galloway Run-Walk-Run** | [RunnersConnect ratio table](https://runnersconnect.net/galloway-run-walk-run/) | The run/walk ratio comes from a pace table: 8:00/mi → 4:00/0:35, 10:00/mi → 3:00/1:00, 13:00/mi → 1:00/1:00, 15:00/mi → 0:30/0:45 (tables differ between sources). The long run grows weekly. The Magic Mile time trial resets the pace used for the ratio and goals (Galloway rule of thumb: magic mile × ~1.3 ≈ marathon pace; from memory, unverified). | **ONE-NODE (N1)** | The ratio lookup is `bands(key: pace, rows…)`, which works because pace is a scalar quantity once (c) lands. The ratio feeds the (b) repeat block. The Magic Mile handler has to read the trial's time, which needs N1. | A table keyed by pace whose output is a block shape. Lower pace is faster, so the bands order is inverted. |
| 3 | **Hal Higdon Novice 1 marathon** | [TrainingPeaks listing](https://www.trainingpeaks.com/training-plans/running/marathon/tp-139218/hal-higdon-marathon-novice-1), [RunningWithRock](https://runningwithrock.com/hal-higdon-marathon-training-plan/) | 18 weeks, 4 run days plus 1 cross-train day. A fixed table of daily distances: the long run starts at 6 mi and reaches 20 mi in week 16, and step-back weeks are written into the table. Average about 24 mpw. 3-week taper. No speedwork, no feedback. | **NATIVE** | Each slot's plan is `schedule('week','hold', …18 distance rows)`. Cross-training is a duration slot. A `peakOn` macro anchors race day. | Nothing hard. It is a pure table. "Conversational pace" has no honest target field without N5 (cardio RPE), so it stays unprescribed. |
| 4 | **Hansons Marathon Method** | [Marathon Handbook](https://marathonhandbook.com/hansons-marathon-method/) | Three SOS workouts a week (speed, tempo at goal MP, long run capped at 16 mi). The other days are easy. Fixed weekly table. Paces are goal pace ± offsets. | **NATIVE** | Goal MP is a program param. Workout paces are `add(param.mp, offset)` in pace units. Fixed schedule. | Cumulative fatigue is a design rationale, not a rule. There is nothing to execute. |
| 5 | **Pfitzinger 18/55** | [RunningWithRock, Pfitz explained](https://runningwithrock.com/pfitz-marathon-training-explained/) | Five mesocycles: Endurance → LT+Endurance → Race prep (VO2 intervals, tune-up races) → 3-week taper → 5-week recovery. Peak 55 mpw. Workouts: LT tempo at 15K–HM pace, medium-long runs, VO2 5×1000 m at 5K pace, MP runs, recovery and general-aerobic runs by % HRmax / HRR. Tune-up races do not recalibrate anything. | **NATIVE** | A `peakOn` macro with fixed phases is exactly the type the algebra admits. HRmax and resting HR are params. Karvonen (`rest + pct × (max − rest)`) is plain arithmetic. | HR-reserve arithmetic needs HR as a dimension: N3, part of the same units work as (c). |
| 6 | **Daniels VDOT** (*Running Formula*) | [VDOT pace calculator](https://rundida.com/tools/training-pace/), [VDOT calculator](https://shuichi-running.com/en/vdot-calculator-tool/) | A race or time trial gives VDOT, and VDOT gives E/M/T/I/R paces (≈59–74 / 75–84 / 83–88 / 95–100 / 105–120 %VDOT). Recompute every 4–6 weeks from a race. Raise VDOT by at most 1 point at a time, and hold a training load ~4 weeks before raising it. Quality volume is capped as a share of weekly mileage (T ≤ ~10%, I ≤ ~8%, R ≤ ~5%). 4 phases (base, R, I, T emphasis). | **ONE-NODE (N1 + N4)** | VDOT is state on a `race`/`test` slot, and other slots read it with `peerState`. "Raise by at most 1" is `min(new, add(old, 1))`. Paces come from library `bands` tables (the book's integer-VDOT tables), so no `exp` former is needed. The %-of-weekly-mileage caps need N4. The race result needs N1. | The race-time ↔ VDOT ↔ pace mapping is a nonlinear regression (Daniels–Gilbert exponentials). It is encoded either as large published tables (`bands`, ~50 rows × 5 paces) or with an `exp` former. Tables are faithful, and an `exp` former is avoidable. |
| 7 | **80/20 Running (Fitzgerald)** | [Grounded Curiosity review](https://groundedcuriosity.com/book-review-80-20-running-run-stronger-and-race-faster-by-training-slower-by-matt-fitzgerald/) | About 80% of time below the ventilatory threshold (VT ≈ 77–79% HRmax) and 20% moderate or hard. Zones are set from LTHR or threshold pace. Plans are fixed tables (foundation, recovery, fast-finish, tempo, cruise intervals, hill repeats). Periodic retest of LTHR. | **ONE-NODE (N1)** | Zone targets are `mul(pct, state.lthr)` ranges with the HR unit from N3. Fixed plan tables. The LTHR retest handler needs N1 (average HR over the last 20 min of a 30-min TT). | The 80/20 split is a distribution constraint over a week. Authored plans satisfy it by construction. Live compliance needs performed time-in-zone, which comes from HR streams and so from the telemetry service. |
| 8 | **Norwegian 4×4 (NTNU)** | [Outliyr protocol](https://outliyr.com/reports/norwegian-4x4) | 10-min warm-up, then 4 × (4 min at 85–95% HRmax with 3 min active recovery at 60–70%), then a 5-min cool-down. 2–3× a week. No load progression: you get faster at the same HR. | **ONE-NODE (N3: bpm)** | Steps are timed work with HR-range targets in a (b) repeat block. HRmax is a param. Strictly, it only needs HR as a dimension. | HR targets are ranges relative to a personal maximum, and recovery has its own target, not just "rest". |
| 9 | **Norwegian singles (sub-threshold)** | [Marathon Handbook](https://marathonhandbook.com/norwegian-singles-training/), [coachathletics](https://coachathletics.com.au/coaching-education/the-norweigan-model-of-lactate-threshold-training) | 2–3 sub-threshold sessions a week (for example 6×1 km, 5×6 min, 10×3 min, short recoveries), everything else easy. Intensity is held at about 2–3.5 mmol/L lactate (or the HR/pace proxy). The pace drifts down with fitness. Strict practitioners adjust the next rep's pace from the lactate reading of the previous rep. | **ONE-NODE (N7, plus N2 lactate)** | The pace or HR-proxy version is NATIVE. The lactate-guided version needs a lactate input or performed field and a read of the previous set in the same step (N7). The telescope only allows reads of earlier steps, so 10 reps would have to be unrolled into 10 steps. | Correcting intensity rep by rep inside one repeated step. |
| 10 | **MAF (Maffetone 180)** | [Uphill Athlete MAF](https://uphillathlete.com/aerobic-training/maf-method-for-determining-your-aerobic-threshold/), [philmaffetone.com 180 review](https://philmaffetone.com/the-180-review) | Cap HR = 180 − age, −5 if injured, regressed, frequently ill or inconsistent, +5 if 2+ years of progress with no problems. All aerobic work stays below the cap. Regular (about monthly) MAF test: fixed distance at the MAF HR, pace recorded. Pace should fall over time. If it plateaus or regresses, drop intensity work. | **ONE-NODE (N1)** | `sub(180 bpm, age)` plus a `match` over a category enum. Age is a param or an input. The target is an HR ceiling (fix (a) must allow open-lower ranges). The test is a `test` week role. The handler compares pace with the previous MAF pace (N1) and proposes a category drop. | The progression variable (pace at a fixed HR) is a measured outcome, not a prescribed target. The engine tracks it as state and never prescribes it. |
| 11 | **Zone 2 (San Millán / Attia)** | [TrainerRoad forum, San Millán](https://www.trainerroad.com/forum/t/zone-2-training-with-inigo-san-millan-part-2/71079?page=9), [ctyeh summary](https://ctyeh.com/articles/2019?lang=en) | Steady work at about 2 mmol/L lactate (talk or nose-breathing test as proxy). About 3–4 sessions a week of 45–90 min in base season, dropping to 1–2 a week once threshold and VO2 work starts. Progression is power or pace at the same lactate. | **ONE-NODE (N4, plus N2 lactate)** | A per-session duration and HR or power ceiling is NATIVE. The weekly hours target ("3–4 h of Z2") needs a weekly volume aggregate in time units (N4). Calibrating by lactate needs the lactate input. | The target is weekly time-in-zone, not a per-session prescription. |
| 12 | **Tabata (1996 protocol)** | [ACE](https://www.acefitness.org/prosourcearticle/3743/is-tabata-all-it-s-cracked-up-to-be), [Breaking Muscle](https://breakingmuscle.com/fitness/how-tabata-really-works-what-the-research-says) | 8 × (20 s at ~170% VO2max power / 10 s rest) on a braked cycle ergometer. In the paper, power went up by 11 W once the subject could complete more than 9 sets before exhaustion (recalled from the original paper; verify). | **ONE-NODE (N3: watts, plus N1)** | `count: { k:'until', stop: not(completed), max: 12 }` already exists for "until exhaustion". `set({ reps: timed(sec(20)), rest: sec(10), power… })` needs the W unit. The +11 W handler needs the number of completed sets (N1). | Intensity is a % of an external maximum (VO2max power), and the progression trigger is a count of sets to failure. |
| 13 | **EMOM bike (Assault/Echo calories)** | [WOD Generator EMOM guide](https://www.thewodgenerator.com/resources/complete-guide-emom-wods/), [Assault Fitness](https://www.assaultfitness.com/blogs/university/how-to-program-the-assaultbike-in-your-workouts/) | Every minute, N calories (sized to take about 40–50 s), for 10–30 min, often alternating with a lift. Progression: +1 cal per round once every round is completed inside the minute. | **ONE-NODE (N3: kcal)** | The `emom` Group already exists and a slot inside it has a fixed set count. The work spec has to be "N calories", an energy dimension. The rule is `lib/linear-gated`, but that is monomorphic in mass (see N6). | "Completed inside the minute" is a pass/fail on time-to-complete. The work quantity is calories, not reps or time. |
| 14 | **Pete Plan (Concept2 rowing)** | [C2 forum, 24-week Pete Plan](https://www.c2forum.com/viewtopic.php?p=485944), [C2 forum, Pete Plan thread](https://c2forum.com/viewtopic.php?p=498902) | 6 days a week. Interval days rotate on a 3-week cycle (for example W1 D1 8×500 m / 3:30 rest), alternating with steady 8–15 km days and one hard long piece (for example 10K). The core rule (forum convention, from memory): on every interval session, beat your average split from the last time you did that same session. Rest is fixed. | **ONE-NODE (N1)** | The 3-week, 18-day rotation is `Rotation { k:'alternate', days:[…18], perWeek: 6 }`. Each interval day is its own slot with `best` split state, so "beat last time" is `lt(target, self.best)` in pace units. Writing `best` needs the performed split (N1). | Progression is "beat your own last split", with lower-is-better pace comparisons. The microcycle is 3 weeks, not 1. |
| 15 | **Swimming CSS** | [MyProCoach CSS](https://support.myprocoach.net/hc/en-us/articles/360040593392), [ctyeh CSS](https://ctyeh.com/articles/2795?lang=en) | CSS pace/100 m = (T400 − T200) ÷ 2 from two max trials. Zones are % of CSS pace (Z1 110–115% … Z5 <95%). Main sets are send-offs ("10×100 on 1:45" at CSS + a few seconds). Retest on schedule, or early when paces feel wrong. | **ONE-NODE (N1)** | `div(sub(t400, t200), q(200,'m'))` gives pace (time/length), which is plain arithmetic. A send-off is `emom(every: 1:45, slot)` with one slot, already expressible. Retest is a `test` role, and the handler needs both trial times (N1). | Send-off timing: rest is derived as cycle time minus swim time, not prescribed. |
| 16 | **Cycling FTP: sweet-spot base** | [TrainerRoad sweet spot](https://www.trainerroad.com/de/sweet-spot-training), [TrainerRoad forum, retest FTP](https://trainerroad.com/forum/t/re-test-ftp-or-nah/31296) | Intervals at 88–94% FTP (for example 3×12 → 3×20 min), with time-in-zone growing each week through the base block. Retest FTP between blocks (ramp test ≈ 75% of best 1-min power, or 95% of a 20-min test). | **ONE-NODE (N3: W, plus N2 `ftp` input or N1)** | Power targets are `mul(pct, state.ftp)` ranges. Weekly time-in-zone growth is a `schedule`. The 20-min test is N1 (average power). The ramp test's best-1-min-power comes from a stream, so it arrives as an input from telemetry. | Test results that are stream maxima, such as best 1-min power. |
| 17 | **Return to running after injury** | [Pabau RTR protocol](https://pabau.com/blog/return-to-running-protocol-physical-therapy/), [Brigham and Women's program](https://www.brighamandwomens.org:443/assets/bwh/patients-and-families/pdfs/le---running-injury-prevention-tips-and-return-to-running-program.pdf) | Entry criteria: 30 min brisk walk pain-free, single-leg balance 30 s, ≥80% strength symmetry. Walk/run ladder: 1/4 → 2/3 → 3/2 → 5/1 min over about 4 weeks. Pain rated 0–10 during the run and 24 h after: green 0–2 continue, amber 3–4 hold (2 ambers in a row drop one stage), red 5+ stop and drop two stages. | **ONE-NODE (N5: pain 0–10 scale)** | A rung ladder like C25K, plus `byLevel`/`bands` over a 0–10 pain scale (the existing `jointPain` is 0–3). The 24-h pain arrives before the next session as a pre-session input (the soreness pattern). Regression is a `rung − 2` commit. The entry criteria are a bounded macro phase whose `advanceWhen` reads inputs. | Delayed feedback: the next-day reading must gate the next session, not the one it describes. Medical, so regressions should be `propose`. |
| 18 | **Uphill Athlete AeT / ADS** (extra) | [Uphill Athlete ADS](https://uphillathlete.com/?p=8851), [HR drift test](https://uphillathlete.com/?p=10980) | AeT from a 1-h HR-drift test: drift <5% means AeT is at or above that HR, otherwise retest lower. If the LT HR is more than about 10% above the AeT HR (aerobic deficiency), keep nearly everything at or below AeT. Once the gap is under 10%, add Zone 3–4 work. | **ONE-NODE (N2: `hrDrift` input)** | The gate `le(div(lt, aet), 1.10)` is native and selects the session policy (`match`/`if` in the plan). Drift (first-half vs second-half pace:HR) is a stream statistic, so it comes in as an input. | The gate between phases is a ratio of two personal thresholds measured by different tests. |
| 19 | **Friel LTHR zones (cycling)** (extra) | [TrainingPeaks, Friel zones](https://www.trainingpeaks.com/learn/articles/joe-friel-s-quick-guide-to-setting-zones/) | 30-min solo TT, average HR of the last 20 min = LTHR. Bike zones: Z1 <81%, Z2 81–89, Z3 90–93, Z4 94–99, Z5a 100–102, Z5b 103–106, Z5c >106% of LTHR. Retest periodically. | **ONE-NODE (N1)** | Zones are a `bands` table over `% of state.lthr`. The test handler reads average HR over a sub-window of the step, which needs N1 with a window pick, or the device-computed value as an input. | "Average over the last 20 of 30 min" is a sub-window statistic. |
| 20 | **TrainingPeaks PMC: CTL ramp-rate planning** (extra) | Coggan/Banister model (standard; CTL = 42-day EWMA of daily TSS, ATL = 7-day, TSB = CTL − ATL) | Plan weekly TSS so CTL rises about 3–8 points a week. Taper until TSB reaches a target on race day. TSS needs normalized power (30-s rolling 4th-power mean of the power stream). | **OUT OF SCOPE** (as engine computation) | A daily EWMA over all history plus NP from raw streams. The engine has no daily event, no `exp`/`pow`, and handlers see one event, not a window. Building it in-engine means a stream processor in the calculus. | Stream-derived load (NP, TSS) and an exponentially weighted history. The right home is an analytics service that publishes CTL/ATL/TSB as inputs, which the engine reads like `e1rm`. |
| 21 | **TrainerRoad Adaptive Training / progression levels** (extra) | [TrainerRoad forum](https://www.trainerroad.com/forum/t/ftp-test-vs-ramp-test/14769?page=2) | Workouts are chosen by per-zone "progression levels" that a trained model moves up and down from completion, survey answers and power data. | **OUT OF SCOPE** | A proprietary learned policy has no honest prose or totality guarantee, so it violates D1 to D4 by construction. Its outputs (an FTP, a chosen level) could still be fed in as inputs. | An opaque model. Nothing to describe. |

**Counts.**

| Bucket | Programs | Count |
|---|---|---|
| NATIVE | #1, #3, #4, #5 | 4 |
| ONE-NODE | #2, #6–#19 | 15 |
| MODEL CHANGE | none forced; N6 is recommended and cross-cutting | 0 |
| OUT OF SCOPE | #20, #21 | 2 |

## Patterns this slice demands

Each pattern ends with the nodes it implies beyond (a), (b) and (c).

### Pace units and arithmetic

- **Pace is the reciprocal dimension of speed.** `pace: { time: 1, length: -1 }` is a new named Dim alongside `speed`, with `MulTable 'pace*length' → 'time'` and `DivTable 'time/length' → 'pace'`. Notations: `minPerKm`, `minPerMi`, `secPer500m` (rowing), `secPer100m` and `secPer100yd` (swimming). Each is a scale, so this is fix (c). Distance notations `km`, `mi` and `yd` are missing too (only `m` exists).
- **Lower pace is better.** Every "beat it", "faster than" and bands table keyed on pace runs in reverse. The algebra's `cmp` is correct as is. The risk is in library templates and describers saying "above" for a faster pace. Describers for pace-dimension comparisons should say "faster/slower", and `bands` over pace should render rows in pace order.
- **Arithmetic the corpus actually uses.** All of it is already in the calculus:
  - pace ± seconds (Hansons, CSS + 2 s)
  - pace × pct (CSS zones)
  - (T400 − T200)/200 m (CSS)
  - `min(new, old + 1)` (VDOT)
  - `180 − age ± 5` (MAF)
  - Karvonen `rest + p × (max − rest)` (Pfitz)
- **No `exp` is needed** if the Daniels tables are encoded as library `bands`. Rounding pace to the nearest second uses the existing `round`.

### Work quantity: what ends a set

- **Generalize `RepSpec` into a work spec.** It should be `exact | range | amrap | until` over any extensive quantity: reps, time, length, energy. Fix (a) as named adds fields. The cleaner form makes this the one work-spec slot, so "1000 m", "20 s", "12 cal" and "5 reps" share one former and one describer.
- **Intensity becomes one field.** Today it is lifting-shaped: `load` (mass) plus `effort` (RIR). Cardio needs one intensity field that accepts `load | pace | speed | power | HR | effort`. It needs a range or one-sided bound form for zones and ceilings (MAF, Z2), and a relative form (`pct × threshold state`) that the describer renders as "85–95% of your max HR".

### HR zones as personal thresholds (N2, N3)

- **Every cardio method has a threshold.** HRmax, HRrest, LTHR, MAF HR, AeT HR, FTP, CSS, VDOT, lactate turnpoints. Where they come from decides how they're modeled:
  - **Set once by the user** (HRmax for Pfitz and 4×4, goal MP): a program param. NATIVE.
  - **Set by a test the program prescribes** (CSS, VDOT, 20-min FTP, Friel LTHR, MAF pace): slot state written by a `test`-role session handler. Other slots read it with `peerState`, exactly as BBB reads the squat TM. Needs N1.
  - **Computed by a device or service from streams** (ramp-test FTP, HR drift, auto-LTHR, lactate): an input registry entry (N2): `ftp`, `lthr`, `hrDrift`, `lactate`, and `ctl`/`atl`/`tsb` if PMC is ever wanted.
- **N3, units.** HR must not be `time⁻¹`, or it unifies with cadence and stroke rate. Add a base dimension `beat` so that bpm = `{beat:1, time:-1}`. Add `stroke`/`step` the same way if cadence targets are wanted. Add `power` (W, as `{mass:1,length:2,time:-3}`, which the vector already supports), `energy` (kcal), and `concentration` (mmol/L for lactate). Each is one `UNITS` row plus a `DIMS` row.
- **N5, scales.** Cardio RPE (CR10 or Borg) is NOT RIR. The algebra hard-codes `rpe = 10 − rir`, which is true only for resistance sets. Cardio needs a separate ordinal `Scale` (`cardioRpe: 0…10`) so "conversational", "RPE 7 tempo" and session-RPE are honest and never unify with reps in reserve. Also add `pain: 0…10` for the return-to-run traffic light (the existing `jointPain` is 0–3).

### Work/rest interval structure (fix (b), plus notes)

- **Shapes seen:**
  - fixed alternation (4×4, Tabata, Galloway)
  - heterogeneous blocks (C25K W3–W4, RTR)
  - send-off cycles (swim "on 1:45": rest = cycle − work)
  - EMOM across slots
  - recovery segments with their own intensity target (4×4 recovery at 60–70% HRmax, so a recovery is not just `rest`)
- **Already expressible:** `emom` with one slot covers send-offs, and `count.until` covers to-exhaustion (Tabata).
- **(b) must allow a recovery that is itself a target.** Make blocks repeat steps rather than repeat sets with `rest`.
- **N7 (optional).** A target reading the previous set of the same step. Only lactate- or HR-guided rep-to-rep correction needs it (Norwegian singles). Without it, authors unroll N reps into N steps, which works but hurts prose.

### Weekly mileage aggregates and the 10% rule (N4)

- **The aggregate machine is sets-only.** It is muscle-scoped, with `AggQuery` = `slotsFor | plannedSets | weeklySets`, all in sets. Cardio needs a program-scope query over any extensive dimension:
  - `plannedVolume { dim, where? }`: weekly planned km or hours, optionally filtered by zone or intensity
  - `performedVolume { dim, week }`
- **What N4 enables:**
  - Daniels caps (T ≤ 10% of weekly km): the aggregate commits a per-slot cap into `program` state, which the slot plan reads. This is the same pattern as RP `extra`.
  - Zone-2 hours a week.
  - 10% rule: state `lastWeekKm` written at `weekEnd`, next week's volume `min(planned, 1.1 × lastWeekKm)`.
- **The evidence undercuts the 10% rule.** It is a weak predictor. Nielsen 2014 found that >30% two-week jumps raise risk. A larger 5,000-runner study found week-to-week % and ACWR barely predicted injury, while a single long run more than 10% over the longest run of the previous month did ([Marathon Handbook](https://marathonhandbook.com/the-10-rule-new-study-suggests-weve-been-doing-it-wrong-this-whole-time/), [Outside](https://run.outsideonline.com/training/getting-started/myth-of-the-10-percent-rule/?scope=anon)). That rule needs a 4-week window max.
  - In-algebra, it is expressible as a ground `List` ring buffer in state, updated by a `fold` at `weekEnd`.
  - It is clunky, and it is concrete evidence for the rationale's open `lastN` question. Recommend a bounded `lastN(field, n: literal)` read, or accept the ring buffer.
- **`allocate` is typed to sets.** If a method wants to hand out weekly km among runs (none of the 21 strictly does), that is N6 territory.

### Test-week recalibration (N1)

- **VDOT, FTP, CSS, MAF, LTHR, Magic Mile and Pete "beat last" share one shape.** A `test`-role session, then a handler that reads the performed result, a commit to threshold state, and a clamp (VDOT +1 max). Peers read the new state.
- **The calculus already has the pieces.** `test` is a week role, `cycleEnd`/`blockEnd` handlers exist, `peerState` exists, and `bounded` macro phases can repeat until a test passes.
- **The one missing piece is N1.** `EventQuery` (and `PerformedField`) only speak `reps | load | effort | completed | e1rm`. Add `metric { step, field: duration | distance | avgPace | avgHr | avgPower | energy, pick: last | best | worst | sum | count }`, typed by the field's dimension. If fix (a) is specified as targets only, it leaves this read side out. N1 is the twin of (a) and should ship in the same change. Sub-window statistics (Friel's last 20 min, ramp best-1-min) are stream statistics and come from telemetry as inputs, not as `pick` options.

### N6: dimension-polymorphic library functions (model change, recommended)

`fn` signatures are monomorphic: `ty.q('mass')`. `lib/linear-gated`, `lib/double-progression` and `hitAll` are all written for mass and reps. Cardio wants the same progressions over kcal (EMOM), seconds (C25K-style time ramps), metres, watts and pace. The options:

1. Duplicate each library function per dimension. No language change, but the library grows about 5×.
2. Allow a dimension variable in `FnDef` params (`∀d. q[d]`). This is checkable with the existing vector unifier, prose is unaffected, and totality is untouched.

Recommend option 2. No single program needs it, so it is not counted as a MODEL CHANGE classification.

## Verdict: cardio in-engine or a separate service?

**Cardio prescription and progression belong in the engine. Cardio telemetry belongs in a separate ingestion and analytics service that writes facts the engine reads.**

**For the engine.**

- **Coverage.** 19 of 21 programs fit with the three known fixes plus small additions:
  - registry rows: units, inputs, scales
  - one EventQuery generalization (N1)
  - one AggQuery generalization (N4)
- **No new scope or machine shape.** C25K, RTR and Galloway are ladders like `stab-ladder`. Daniels, CSS, FTP and MAF are TM-style threshold state with test handlers. Pfitz and Higdon are `peakOn` macros with fixed phases. Swim send-offs and EMOM bike are the existing `emom` group. Tabata is the existing `count.until`.
- **The engine already models the concepts cardio relies on.** Threshold state read by peers, issued targets as facts, week roles including `test` and `taper`, and macros anchored on race day are the 5/3/1 and peaking concepts, renamed.
- **A split creates two program languages.** A separate cardio engine would need its own calendar, macro, describer and coach and MCP surface. Hybrid athletes (lifting plus running, OPT, CrossFit EMOMs) would be split across two program definitions with no shared week.

**For the separate service.**

- **What the two out-of-scope programs show.** Both are stream-derived or learned: NP and TSS, the CTL/ATL EWMA, best-N-second power, HR drift, time-in-zone, GPS pace smoothing, lactate devices. These are signal processing over high-frequency samples from FIT/Strava/HealthKit.
- **What the engine's contract excludes.** The engine works on per-set facts, is total, and keeps prose for every term. A stream processor inside it would break the phrase budget and the one-event handler model.
- **What the service does.** It ingests streams, computes summaries, and publishes:
  - per-set performed summaries (avg HR, avg power, time-in-zone), which become N1 fields
  - input observations (`ftp`, `lthr`, `hrDrift`, `ctl`, `tsb`), which become N2 entries, stamped like `e1rm`
- **Live in-workout control is a third concern.** "Beep when HR passes the MAF cap" or "walk until HR drops" runs on the watch or device layer. It is out of both.

**Minimal node set if in-engine, beyond (a), (b) and (c).**

| Node | Kind | What | Needed by |
|---|---|---|---|
| N1 | EventQuery / PerformedField generalization | `metric{step, field, pick}` over duration, distance, avgPace, avgHr, avgPower, energy | every recalibration: #2, #6, #7, #10, #12, #14, #15, #19 |
| N3 | units / dims | `beat` base dim (bpm), W (power), kcal (energy), mmol/L (concentration), km/mi/yd. Pace is (c). | #5, #8, #12, #13, #16 |
| N2 | input registry rows | `ftp`, `lthr`, `hrDrift`, `lactate` (plus `age` if not a param). PMC rows only if the service exists. | #9, #11, #16, #18 |
| N4 | AggQuery generalization | `plannedVolume{dim, where}`, `performedVolume{dim, week}` at program scope | #6, #11, 10%-rule policies |
| N5 | scales | `cardioRpe 0–10` (not RIR), `pain 0–10` | #3 (honest easy pace), #17 |
| N7 (optional) | read | previous set of the same step in a live target | #9 strict lactate-guided |
| N6 (recommended) | model change, small | dimension variables in FnDef signatures | reuse of the progression library across dimensions |

Prerequisite framing for (a): specify it as a work spec over any extensive dim plus one intensity field with range or ceiling and relative-to-state forms. Do not specify it as a list of new nullable columns. That keeps one describer per concept and makes N1 its natural read-side twin.
