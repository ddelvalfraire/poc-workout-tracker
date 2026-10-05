# Time model for the training-program algebra

Status: recommendation, for amendment H of the consolidated amendment list v2 (`corpus/corpus-summary.md`). Base: the round-2 synthesis package (`arena2/synthesis/`). Vocabulary below is that package's: `Term`, `Cap`, position grants, `StateDecl.writableBy`, `IssuedSession`, `Stamp`, `Event` with `causeKey`, `Head`, laws L1 to L10.

Source tags used in the catalog:
**OWN** the owner's ask (time-brief.md). **REV** the adversarial review round and its amendment list. **SYN** synthesis rationale and note. **STR** slice-strength. **HYP** slice-hypertrophy. **CAR** slice-cardio. **UNC** slice-uncommon. **PT** slice-research-pt. **TP** test-plan. **APP** the app (`src/db/schema.ts`, `src/lib/local-day.ts`, `src/lib/home/schedule-anchor.ts`, recorded memory).

## 1. Demand catalog (deduped)

### Frequency and adherence

- **T1. Sessions per week.** "3 days a week" is the default shape of nearly every program. Sources: STR (SS, StrongLifts, Texas), HYP (PHUL, DC 3/wk), CAR (Pfitz, Higdon, Z2 3 to 4/wk), PT (HSR 3/wk, van Ark 4/wk, Otago 3/wk, GLA:D 2/wk), APP (`program_days.weekdays`).
- **T2. Frequency per selector.** "Legs 3 times in 7 days" (OWN). Muscle frequency of 2 to 3 sessions a week (PT Wernbom). Hard-run counts (CAR).
- **T3. Frequency within a day.** Alfredson twice a day, Tyler daily, post-THR 5 times a day, McKenzie every 2 hours (PT). Bulgarian twice a day (STR). 100 push-ups daily (UNC).
- **T4. "Missed" as a derivable fact for any calendar.** "Missed one workout in the program's last week" (OWN). A completed fraction for the predecessor seed channel (REV, amendment E). A broken streak needs an event on a day with no session (UNC).

### Spacing and cadence

- **T5. State-driven spacing.** Mentzer adds rest days after stalls (HYP, the slice's only model break). Fees soreness rules say "2 days off and drop a level" (PT, ACL).
- **T6. Fixed day-cycle cadence and rest days.** Every 4th day, PPL-rest (HYP `everyNDays`). PT asks for a rest outcome that is issued and described like a prescription.
- **T7. Minimum spacing between tagged sessions.** "48 h between hard runs" (CAR, REV). "No more than 2 consecutive days" (OWN brief).
- **T8. Days since the last session.** The StrongLifts layoff rule "14+ days off, restart at 90%" and SS resets (STR). Detraining in general (OWN brief).
- **T9. A day clock for progression.** "Walk a little further each day" (PT post-THR). Per-day soreness rules (PT ACL).

### Windows

- **T10. Bounded rolling windows over history.** The long run must stay within 10% of the longest run in the previous 4 weeks (CAR). The 10% weekly rule (CAR). Z2 hours a week (CAR N4). The synthesis left "`lastN` or windows in state" open (SYN). Ring buffers in state were found "possible but clunky and opaque to prose" (CAR).
- **T11. Stream-derived load models.** ACWR, CTL/ATL/TSB, NP (CAR). The corpus already routes these to a boundary service that publishes inputs.

### Calendar truth

- **T12. Weeks must not advance without training.** Date-driven catch-up bumps a 5/3/1 TM on zero training (TP EC-166). A week-4 session issued before cycleEnd is ingested carries a stale TM (TP BV-32, BV-33). Crash between two catch-up events (TP EC-173). Prescribing past a `once` calendar is undefined (TP EC-161).
- **T13. Provenance and completed-only counting.** A workout's day is never reassigned. Only completed sessions count. One program entity per block (APP memory). An empty finish must never count (TP EC-177, BV-61, APP current branch).
- **T14. The local day is a client fact.** The server renders in UTC and has no stored user timezone. "Same day" is computed client-side after mount (APP `local-day.ts`, `schedule-anchor.ts`).
- **T15. Replay determinism.** Handler input reads break replay today (REV, amendment C). Late logs apply in ingestion order (SYN Q4, L5).

### Bounds

- **T16. Deadlines.** `peakOn(date)` for meets and races, taper to race day (STR, CAR). `Exit.date` semantics were left open (REV).
- **T17. Program lifecycle in time.** Duration, pause or vacation, abandon versus complete (OWN).
- **T18. Calendar time floors on phases.** ACL return to sport no earlier than 9 months after surgery. Rotator-cuff phases in weeks after surgery (PT).
- **T19. A safety phase must not time out.** `bounded.max` auto-advances even when criteria fail (PT ACL, rotator cuff, TP EC-C10).

### Rest at every scope

- **T20. Rest inside a set.** Cluster intra-set rest, hangboard 7 s on and 3 s off (PT, UNC).
- **T21. Recovery as a target.** 4x4 recovery at 60 to 70% HRmax, run/walk blocks (CAR, REV amendment G).
- **T22. Group rest ownership.** Rest between superset members versus after the pair (REV NASM). EMOM `every`, `amrapFor` cap. Groups are unchecked and undescribed today (UNC, a D1 hole).
- **T23. Sub-day spread.** GTG sets spread through the day, hourly walks, every 2 hours (UNC, PT). Both slices call this a scheduling cue, not program logic.
- **T24. Time for fixed work.** Fran, Murph, EDT density, session duration as an event fact (UNC, TP EC-C12). This is a performed metric, not a clock.

### Adjacent, carried for composition

- **T25. Input freshness.** Inputs carry `observedAt`, and amendment D adds an observed axis and freshness (REV).
- **T26. Repeat a week.** C25K "repeat the week" means the schedule clock must be progress, not the calendar (PT, CAR).

## 2. The time model

### 2.1 Decision in one paragraph

Time has two clocks, and they never mix. The **progress clock** counts training that happened: `pos.week`, `pos.trainWeek`, `pos.role` and `pos.slotSession`, which already exist. It advances only when sessions close, so it drives prescription content and progression. The **calendar clock** counts local days since the program instance's anchor. It drives expectations, adherence, spacing, gaps and windows, and it is read through one new term former, `cal`, with its own capability. The wall clock never enters the language. The boundary turns instants into stamped `LocalDay` values once, and every calendar read evaluates against a stamped day. Frequency is one declaration sort with three consumers: the checker proves it is feasible, `prescribe` turns it into an immutable due verdict, and a per-day reconciliation event turns it into adherence facts. "Missed" is therefore an issued expectation that closed unmet, which is a fact rather than a derivation. Time alone can never commit a state change.

Rejected in one line each:
- **Counters only (status quo).** It cannot express missed sessions, gaps, cadence or day clocks. Nine demands go unmet.
- **Full wall clock in the language.** Hours and zones in terms break replay unless stamped. No corpus program needs hour arithmetic once reminders are excluded.
- **Calendar-driven progress for every program.** It is the EC-166 bug. It survives only as the opt-in `anchored` drift that deadlines require.
- **The calendar as a function of state.** Mentzer needs "next session not before", which a gap declaration over state gives at a fraction of the cost.

### 2.2 Q1. The clock ladder

| Clock | Values | Advances on | Read through | Granted to |
|---|---|---|---|---|
| Progress | `pos.week`, `pos.trainWeek`, `pos.role`, `pos.slotSession` (q[weeks], enum, q[one]) | closed training, owner skips, and the calendar under `anchored` drift only | `pos` cap (unchanged) | plan, live, handler, aggregate (unchanged) |
| Calendar | `cal.day`, `cal.occurrence`, `cal.gap(sel)`, `cal.recent(sel, n, measure)` (q[days], q[one], opt q[days], q or count) | local days, by reconciliation | new `cal` cap | plan, live, handler, aggregate, handoff (`advanceWhen`) |
| Wall clock | instants | physics | nothing in the language | the boundary only |

The two clocks get two dimensions. `weeks` (base dim `week`) stays the progress unit. A new base dimension `day` with unit `d` is the calendar unit. Seconds (`time`) stay the unit of rest and work inside a session. `days(2) + weeks(1)` and `rest: days(2)` are `unitMismatch`. The type system enforces that progress and calendar never mix. There is no conversion former. A program that wants "7 days" writes `days(7)`, never `weeks(1)`.

Named definitions (`FnCap`), `init` (`InitCap`) and slot bindings (`BindCap`) do not get `cal`. A library function stays a pure function of its params. A program that wants a calendar-dependent argument passes the read in at a plan position.

**Replay-determinism rule (new law L12, Stamped time).** No term reads "now". Every calendar read evaluates against a stamped `LocalDay`, which is one of three:
1. `IssuedSession.stamp.issuedOn`, which the client supplies at prescribe.
2. `ClosedFacts.localDay`, the day the session STARTED, which the client stamps at session start and which never changes.
3. A `dayClosed` event's `day`.

Each evaluated calendar read is recorded with its value in the stamp of the fact it produced (`Stamp.calReads`, and the transition's trace). This is amendment C's channel. Calendar reads are one more kind of stamped read, not a parallel mechanism. Replaying the ledger reproduces every value, and a late session that changes a window after the fact cannot change a value already stamped.

The boundary validates the client's day stamp. A `LocalDay` more than one day from the UTC date of the session's `startedAt` is refused, because the UTC offset range is -12 to +14 hours. This matches APP: the server never computes the user's day.

### 2.3 Q2. Expectation versus occurrence, and how "missed" becomes a fact

**Occurrence.** A session that closed with at least one logged set (the EC-177 ingest refusal makes empty closes impossible). It carries its stamped `localDay`, its slots, and so its muscles and tags. Only sessions instantiated from the program are occurrences of that program. Ad-hoc workouts are invisible to it, per the provenance law. A session that crosses midnight belongs to the day it started.

**Expectation.** An immutable fact issued per `atLeast` declaration per tumbling window: "at least 3 sessions matching `legs` between 5 and 11 October". It is issued when its window OPENS, snapshotting the head at that moment. A schedule edit mid-window therefore changes the next window, never the current one. This is issued-prescriptions-immutable applied to plans of attendance. Expectations are never issued for days before the instance's activation day, so importing or starting a program never back-fills misses.

**Reconciliation.** One event kind, `dayClosed`, with `causeKey day:{instance}:{localDay}`. `reconcile(head, today)` emits one per day in `(reconciledThrough, today)`. Each one does three things in a fixed order:
1. It closes every expectation whose window ends that day. It writes an `Adherence` fact listing the matching occurrences by workout id and the shortfall as `missed`.
2. It fires `periodClosed` handlers, which may only propose or keep (L13 below).
3. It opens the windows that start the next day by issuing their `Expectation` facts. Then it applies lapse.

`prescribe` and every owner-edit ingestion call `reconcile` first, so any change of the head is preceded by reconciliation through its stamped day. This is what makes "snapshot at window open" exact even when the window opened while the user was away.

**Provenance.** Matching is by stamped `localDay` and selector. No workout is ever moved to another day, re-labelled, or counted twice. A workout satisfies every expectation whose window and selector it falls in. Its own `programWeek` stamp is untouched.

**Idempotency (L5, amended).** Reconcile is a set of per-day causeKeys. Running it twice appends nothing. A crash after day 3 of a 5-day catch-up resumes at day 4 (EC-173). Expectations and adherence are keyed `(instance, rule index, window index)`, so a duplicate is a no-op.

**Late sessions.** A `sessionClosed` whose `localDay` falls in an already-closed window applies in ingestion order (L5, SYN Q4). It appends an `AdherenceAmendment` row and never edits the `Adherence` fact. Derived adherence is the fact folded with its amendments. This is the `Resolution` over `IssuedSession` pattern reused.

### 2.4 Q3. Frequency constraints as declarations

One sort, `Frequency`, on the program, with three forms.

| Form | Meaning | Window | Consumers |
|---|---|---|---|
| `atLeast(n, sel, per)` | an expectation | tumbling, anchored at the instance start: `day`, `week` (7 days), or `days(n)` | checker feasibility, adherence |
| `atMost(n, sel, withinDays)` | a cap | rolling, ending today | checker feasibility, the due verdict |
| `minGap(sel, gap, ceiling)` | spacing | rolling, since the last match | checker feasibility, the due verdict |

Each declaration has three enforcement points, and all three are needed:
- **Checker time.** For literal declarations together with the rotation, the checker searches one hyper-period for an arrangement that satisfies all of them (each period is a literal of at most 28 days, so the search is bounded). It refuses an unsatisfiable set as `infeasibleFrequency` and names the conflicting pair. A term `minGap` must carry a literal `ceiling`. The checker refuses a ceiling that makes an `atLeast` on an overlapping selector unsatisfiable.
- **Prescribe time.** `atMost` and `minGap` are evaluated at the stamped `issuedOn` into a `Due` verdict on the issued session: `due`, or `early { dueOn, rule, reason }`. `dueOn` is the first day on which every cap holds. Searching at most `max(withinDays, ceiling)` days ahead keeps it total. The verdict is part of the immutable fact.
- **Window close.** `atLeast` becomes `Adherence` at `dayClosed`.

The gate is **soft**. An `early` session can still be started, and the occurrence records `startedEarly: true`. Refusing to start a session would block the human, and the provenance law says a performed session is a fact whatever the plan thought. The app is not a jailer. The verdict is what makes the screen say "Rest today", with the reason from the trace.

Rolling `atLeast` is rejected. One missed session would violate up to n overlapping windows, so "missed" would not be a countable fact with one key. The owner's "legs 3 times in 7 days" becomes a tumbling expectation for misses plus a rolling `cal.recent` read for live coaching ("2 legs sessions in the last 7 days"). Section 4 shows both.

**Default frequency.** An empty `frequency` list derives from the rotation, so existing programs gain adherence with no authoring:
- `weekly{days}` gives `atLeast(days.length, any, week)`.
- `alternate{perWeek}` gives `atLeast(perWeek, any, week)`.
- `pattern{days}` gives `atLeast(k, any, days(L))`, where L is the pattern length and k counts its non-rest entries.
- `daily{perDay}` gives `atLeast(perDay, any, day)`.

Prose is in section 3, next to each type.

### 2.5 Q4. Cadence driven by state

The calendar does not become a function of state. Cadence is a `minGap` whose `gap` is a TERM of sort q[days], evaluated at prescribe, stamped, and clamped to its literal `ceiling`. The term sits at a new `cadence` position with grant `CadenceCap = 'param' | 'state' | 'peer'`, where `state` means the program aggregate's own state. Mentzer's growing rest is aggregate state that a `session` handler writes on stalls, which is a training-caused commit. The Fees rule "2 days off" is the same mechanism with a counter that the next session resets.

The ceiling exists for silence over corruption. A runaway state can never make a program that is never due. It also gives the prose its bound ("up to 7 days").

Rejected: a plan outcome `rest` (the PT slice's proposal). A plan that issues a non-session needs a second issuance kind, and it raises a question cadence does not have: does an issued rest advance the progress clock? The `early` verdict is already an issued, described, stamped fact that says rest, and it costs no new outcome.

### 2.6 Q5. Rest at every scope

| Scope | Construct | Unit | Owner | Status |
|---|---|---|---|---|
| inside a set | `cluster{per, intraRest}`, `repeats{on, off, n}` | seconds | the set | amendment G |
| between sets | `set.rest` (passive) | seconds | the set | exists |
| active recovery | a step with role `recovery` and its own metric target | seconds or metric | the step | amendment G (repeat blocks, work/recovery roles) |
| between group members and rounds | `superset{between, after}`, `circuit{restBetweenRounds}`, `emom{every}`, `amrapFor{cap}` | seconds | the GROUP; a member set's `rest` is refused (`restOwnedByGroup`) | checked and described here (closes the D1 hole) |
| between sessions on one day | `cal.occurrence` ordering only | none | out: no hour arithmetic | new |
| between sessions | `minGap(sel, gap, ceiling)` | days | the program | new |
| rest days | `pattern` rotation rest entries, `atMost`, the `early` verdict | days | the program | new |
| deloads | week roles plus `Use` policies (reactive deloads: amendment B) | progress weeks | the program | exists |
| layoff | `cal.gap(sel)` read at plan positions | days | the slot | new |
| vacation | instance `pause` | days | the instance | new |

Three scopes, three units. Seconds live inside a session, days on the calendar, weeks on the progress clock. "Rest" is passive by definition. Anything with a target is a step. Every rest has exactly one owner, the same single-writer idea as L3 applied to structure.

### 2.7 Q6. Bounded rolling windows: in the language

Pick: in the language, as `cal.recent(sel, days, measure)`. `days` is a literal from 1 to 56. The measure is `count`, or `sum` or `max` of a metric from the metric registry (amendment A). The window is the n local days ending on the stamped day, today included. It reads the occurrence ledger, not state.

- **Totality.** The bound is literal and the ledger is finite.
- **Describability.** One describer ("your longest run in the last 28 days").
- **Replay.** The value is stamped where it is used.
- **Load planning.** The largest `days` in a definition is inferred into `Elaborated.reads.calWindow`, so the shell knows how much history to load.
- **`gap`.** `cal.gap` needs no window. The head keeps `lastOn[selectorKey]`, updated by `step`, because selectors are static in the definition.

Rejected:
- **Ring buffers in state.** Every program re-implements them, and their prose is opaque. That is the CAR finding.
- **Boundary-derived session counts.** They would put program selectors (legs, hard runs) in a service that knows no program.

ACWR, EWMA and CTL/ATL/TSB stay boundary-derived inputs (T11). They are fitted models over streams, and the window primitive is not a license to build them in terms. The rationale's accepted trade-off "handlers see one event plus state, not a window of history" is revised to "one event, state, and bounded stamped windows".

### 2.8 Q7. Program time bounds

**Drift is a declaration** on `Calendar`.
- `slide` (the default). The progress week closes when every rotation entry of the week has closed, by completion or by an owner `skip`. A missed week shifts the plan later. Calendar duration is emergent, and projection reports it (see L9 below).
- `anchored`. When an instance week ends on the calendar, unfinished sessions become `skipped` facts and the progress week closes with the calendar.

`peakOn(date)` requires `anchored` as a type rule, extending the existing rule that a peak anchor admits only fixed phases. The checker refuses the IR form as `anchoredRequired`. If a `peakOn` instance is activated after its computed start, the weeks already past are skipped with the reason `startedLate`, and the prose says so: "Starts at week 4 because the meet is in 9 weeks."

**`Exit.date` semantics.** `peakOn(d)` means the final phase's last day is `d`. `startOn(d)` means `cal.day = 0` on `d`, and `d` may be in the past. A surgery date is the canonical case. Days before activation get no expectations.

**Time floors.** `advanceWhen` gains `cal`, so "no earlier than 9 months after surgery" is `ge(cal.day, days(270))` beside the criteria. `bounded` gains `atMax: 'advance' | 'propose'`. A safety gate uses `propose` and never times out into the next phase (T19).

**Progress events are caused by training (new law L11).** weekEnd, cycleEnd and blockEnd are emitted in the same `step` as the `sessionClosed` or `skip` that closes the progress unit, with causeKeys `week:{inst}:{n}` and so on. Under `anchored`, they are emitted by the `dayClosed` that ends the week. A next `prescribe` therefore always sees the post-cycleEnd head, which resolves BV-32 and BV-33 structurally rather than by ordering discipline. A slot's boundary handler with no completed session of that slot inside the boundary's window records `keep` with reason `untrained` and does not run. That resolves EC-166: a cycle with no training never bumps a TM, under either drift.

**Instance lifecycle.** `Instance.status` is one of five values:
- `active`.
- `paused`. An owner event `pause{from, until | null}` records it. Any expectation window that touches a paused day is issued `void`: no miss, and it is excluded from the completed fraction. The progress clock does not move. `cal.gap` keeps counting, because detraining happens on vacation too. Under `anchored`, pausing skips calendar weeks and the confirmation copy says so.
- `lapsed`. Reconciliation records it when no occurrence happened for `lapseAfterDays`, a literal with default 21. Lapse is a stamped fact, not a commit, and it suspends expectations exactly like a pause. The next session resumes the instance. Without lapse, an abandoned-in-practice program emits a miss every week forever, which is noise rather than information.
- `completed`. The progress clock passed the end of a `once` calendar or the last fixed phase. `prescribe` then refuses with `programComplete`, which resolves EC-161: prescribing past the end is refused rather than held.
- `abandoned`. An owner event. Terminal. Every fact stays (provenance). The exports are computed at that point.

`completedFraction` (amendment E) is met / expected over non-void windows, computed at `completed` or `abandoned`. It is a deterministic fold of adherence facts.

### 2.9 Q8. Composition with the open amendment list

Time lands as one change set because every piece rides an amendment already open.
- **A, metric registry.** `cal.recent` measures range over registry metrics. Session duration and time-for-work scores are performed metrics and group scores in A, not clocks (T24). One concept: a duration you performed is a metric, and a duration you wait is a clock.
- **B, policy former.** Policies may read `cal` (readiness gating by gap, reactive deload after a layoff). Frequency stays a declaration, not a policy, because the checker must prove it feasible statically.
- **C, event input snapshots.** `Stamp.calReads` and `ClosedFacts.localDay` are the same stamped-read channel. L12 is C's law extended to the calendar, not a second law.
- **D, facts registry with an observed axis and freshness.** The observed axis becomes `observedOn: LocalDay`, and freshness is a q[days] comparison ("an e1RM older than 28 days is stale"), in the same dimension as gaps.
- **E, exports and the seed channel.** `completedFraction`, `missedTotal`, `lastOn` and `status` become typed exports of every instance. The predecessor seed channel reads them. The macro sequences phases the same way.
- **F, units.** Add base dim `day` and unit `d` beside pace, bpm and angle.
- **G, session structure.** Recovery steps, cluster and repeats carry intra-session rest. Group rest ownership moves into the checked, described `Group` here.
- **Groups checked and described.** The group describers written for rest ownership close the D1 hole the uncommon slice found.
- **I, demonstration obligations.** Add the six worked examples in section 4 as executable programs.
- **J, test-plan adoption.** EC-166, EC-161, BV-32, BV-33 and EC-173 resolve here. Section 6 lists the new classes.

## 3. Sketch deltas

Every new or changed type is shown with the sentence its describer produces, so prose totality visibly holds. Term formers go from 51 to 52, and `cal` is the only new one. Everything else is a declaration or a fact.

```ts
// ── algebra.ts §1. A calendar dimension, distinct from progress weeks and from seconds.
export type BaseDim = 'mass' | 'rep' | 'set' | 'time' | 'length' | 'effort' | 'week' | 'day'
// Dim += 'days';  DIMS.days = { day: 1 };  UNITS.d = { dim: 'days', scale: 1 }
export const days = (n: number) => q(n, 'd')                      // "2 days"

/** A calendar day in the athlete's zone, 'YYYY-MM-DD'. Stamped by the client at the boundary;
 *  the server never computes it. Validated within one day of the instant's UTC date. */
export type LocalDay = string & { readonly __localDay: true }

// ── §4. One capability. Positions: PlanCap += 'cal' (LiveCap and HandlerCap inherit),
//    AggregateCap += 'cal', HandoffCap = 'peer' | 'cal'. FnCap, InitCap, BindCap unchanged.
export type Cap = /* … */ | 'cal'

// ── §5. One former.
| { k: 'cal'; q: CalQuery }

export type Selector =                                             // describes as a noun phrase
  | { s: 'any' }                                                   // "workout"
  | { s: 'slot'; slot: string }                                    // "squat session"
  | { s: 'day'; day: string }                                      // "Day A"
  | { s: 'muscle'; muscles: [string, ...string[]] }                // "legs (quads, hamstrings or glutes as the primary muscle)"
  | { s: 'tag'; tag: string }                                      // "hard run (intervals, tempo or long run)"

export type CalQuery =
  | { q: 'day' }                      // q[days]   "days since you started the program"
  | { q: 'occurrence' }               // q[one]    "which session of the day this is"
  | { q: 'gap'; of: Selector }        // opt q[days] "days since your last {sel}" (none: "you have not done one yet")
  | { q: 'recent'; of: Selector; days: number; measure: Measure }   // days: LITERAL 1..56
export type Measure = { m: 'count' } | { m: 'sum' | 'max'; metric: MetricId }  // MetricId: amendment A
//  count: "how many {sel}s you completed in the last {n} days"
//  max:   "your longest {metric} in a {sel} over the last {n} days"
```

```ts
// ── structure.ts
export interface Calendar {
  weeks: [WeekRole, ...WeekRole[]]
  repeat: 'once' | 'cycle'
  drift: 'slide' | 'anchored'
  // slide:    "If you miss a session the plan waits: the next session is still the one you missed."
  // anchored: "The plan follows the calendar: a week you don't finish closes on schedule and its
  //            remaining sessions are skipped."
}

export type Rotation =
  | { k: 'weekly'; days: string[] }                                // exists
  | { k: 'alternate'; days: string[]; perWeek: number }            // exists
  | { k: 'pattern'; days: [DayOrRest, ...DayOrRest[]] }            // "Train on a 4-day cycle: Day A, then 3 rest days."
  | { k: 'daily'; days: string[]; perDay: number }                 // "Do Heel Drops 2 times every day."
export type DayOrRest = string | { rest: true }

export interface SlotMeta { muscles: Record<string, number>; tags?: string[] }  // tags: static, declared

/** One declaration sort, three consumers: checker feasibility, the due verdict, adherence. */
export type Frequency =
  | { k: 'atLeast'; n: number; of: Selector; per: Period }
  //  "Train legs at least 3 times each week."   (week = 7 days from the program's start day)
  | { k: 'atMost'; n: number; of: Selector; withinDays: number }
  //  "Train on no more than 2 days in any 3 days."
  | { k: 'minGap'; of: Selector; gap: Term; ceiling: number }      // gap: q[days] at CadenceCap
  //  "Leave at least {gap} between workouts, never more than {ceiling} days."
export type Period = { k: 'day' } | { k: 'week' } | { k: 'days'; n: number }   // tumbling, anchored
export type CadenceCap = 'param' | 'state' | 'peer'   // state = the aggregate's; evaluated at prescribe

export interface ProgramDef { /* … */ frequency: Frequency[]; lapseAfterDays: number }
//  lapse: "If you don't train for 21 days, attendance stops counting until your next session."

export type SlotEventKind = 'session' | 'weekEnd' | 'cycleEnd' | 'blockEnd' | 'periodClosed'
export type AggEventKind = 'weekEnd' | 'session' | 'periodClosed'
//  periodClosed handlers may return propose | keep only (refusal `timeCommit`, L13).
//  "At the end of each week, if you missed a session, suggest …"

export type Group =
  | { k: 'single'; slot: string }
  | { k: 'superset'; slots: [string, string, ...string[]]; between: Term; after: Term }
  //  "Superset Bench and Row: no rest between them, then rest 90 s."
  | { k: 'circuit'; slots: [string, ...string[]]; restBetweenRounds: Term }
  | { k: 'emom'; slots: [string, ...string[]]; every: Term }
  | { k: 'amrapFor'; slots: [string, ...string[]]; cap: Term }
//  A member set's own `rest` inside a non-single group is refused: `restOwnedByGroup`.

export type Length =
  | { k: 'fixed' } | { k: 'open' }
  | { k: 'bounded'; min: number; max: number; advanceWhen: Term; atMax: 'advance' | 'propose' }
  //  propose: "Move on after 12 weeks at most, and only with your confirmation if the criteria
  //            still aren't met."
export type MacroSpec =
  | { anchor: { k: 'peakOn'; date: LocalDay }; drift: 'anchored'; phases: [Phase<'fixed'>, ...Phase<'fixed'>[]] }
  | { anchor: { k: 'startOn'; date: LocalDay }; drift: 'slide' | 'anchored'; phases: /* unchanged */ [] }
```

```ts
// ── engine.ts
export interface Instance {
  anchor: LocalDay; activatedOn: LocalDay
  status: 'active' | 'paused' | 'lapsed' | 'completed' | 'abandoned'
}
export interface Head {
  /* seq, state, pendingProposals */
  progress: { week: number; cycle: number; slotSessions: Record<string, number> }  // replaces calendarThrough
  reconciledThrough: LocalDay
  lastOn: Record<string, LocalDay>           // per static selector: feeds cal.gap in O(1)
  instance: Instance
}
export interface ClosedFacts { /* … */ localDay: LocalDay; occurrence: number; startedEarly: boolean }
export interface Stamp { /* … */ issuedOn: LocalDay; calReads: { q: CalQuery; value: Value }[] }

export type Due =
  | { k: 'due' }
  | { k: 'early'; dueOn: LocalDay; rule: number; reason: Trace }
//  "Rest today. Your next workout is due Thursday: at least 4 days between workouts."
export interface IssuedSession { /* … */ due: Due }

export interface Expectation {          // issued when its window opens; immutable (L6)
  key: `expect:${string}:${number}:${number}`   // instance : rule : window index
  window: { from: LocalDay; through: LocalDay }; n: number; of: Selector
  status: 'issued' | 'void'                     // void: the window touched a pause or a lapse
}
export interface Adherence {            // written by the dayClosed that ends the window
  key: `adhere:${string}:${number}:${number}`
  met: { workoutId: string; localDay: LocalDay }[]; missed: number
}
//  "Week 3: 2 of 3 workouts (1 missed)."
export interface AdherenceAmendment { key: `amend:${string}`; adherence: Adherence['key']; workoutId: string }
//  "Thursday's workout was logged late and now counts toward week 3."

export type Event = /* existing */
  | { k: 'dayClosed'; causeKey: `day:${string}:${LocalDay}`; day: LocalDay }
  | { k: 'skip'; causeKey: `skip:${string}`; slot: string; week: number }          // "You skipped Day C of week 2."
  | { k: 'pause'; causeKey: `pause:${string}`; from: LocalDay; until: LocalDay | null } // "Paused 20 to 30 October."
  | { k: 'resume'; causeKey: `resume:${string}`; on: LocalDay }
  | { k: 'abandon'; causeKey: `abandon:${string}`; on: LocalDay }

/** The dayClosed events for (head.reconciledThrough, today). Pure; idempotent by causeKey. */
export declare function reconcile(p: Elaborated<ProgramDef>, head: Head, today: LocalDay): Event[]
/** prescribe gains `today`: reconcile first, then issue with stamp.issuedOn = today and a Due verdict. */
export declare function prescribe(p: Elaborated<ProgramDef>, head: Head, day: string, facts: InputFacts, today: LocalDay): IssuedSession
export type Assume = /* existing */ | { k: 'asScheduled' }   // projection lays sessions on nominal days
```

## 4. Worked micro-examples

### 4.1 "Legs 3 times per rolling 7 days"

```ts
slots: { squat: …bind(…, { muscles: { quads: 1 }, tags: [] }), rdl: …({ hamstrings: 1 }), … },
frequency: [atLeast(3, muscle('quads', 'hamstrings', 'glutes'), week())],
```

- **Expectation prose.** "Train legs at least 3 times each week (weeks start Thursday, the day you started)."
- **Live read.** On the home surface or in a coach policy, `cal.recent(legs, 7, count)` gives "2 legs workouts in the last 7 days". It is a rolling read, stamped when used.
- **The split.** Misses come only from the tumbling window, so one skipped leg day is one miss, not up to seven.
- **Week alignment.** It is the anchor's business, not the language's. The product defaults the anchor to the start of the current week in the user's locale.

### 4.2 "Missed one workout last week"

Setup:
- `rotation: weekly(['A','B','C'])`. The default frequency is `atLeast(3, any, week)`.
- Anchor Monday 5 Oct. `drift: 'slide'`.

Run:
1. `dayClosed(11 Oct)` opens window 1 (12 to 18 Oct) and issues `expect:i:0:1 {n: 3}`.
2. Occurrences: A on Mon 12 Oct and B on Thu 15 Oct.
3. `dayClosed(18 Oct)`, emitted by the catch-up at Monday's first prescribe, writes `adhere:i:0:1 {met: [w12, w15], missed: 1}`. Prose: "Week 2: 2 of 3 workouts (1 missed)."
4. The progress clock still points at C, because the plan waits under `slide`. No weekEnd fired, and no TM moved.

Late arrival:
- C was logged offline on Sun 18 Oct and syncs on 19 Oct.
- The next ingest appends `amend:… {adherence: adhere:i:0:1, workoutId: w18}`. Derived adherence reads 3 of 3.
- The amendment closes the progress week, so weekEnd fires now, in ingestion order.

The answer to "missed one workout in the program's last week" is the last closed window's adherence folded with its amendments. It is never a re-derivation from today's schedule.

### 4.3 Mentzer: rest days grow on a stall

```ts
aggregate: {
  state: { stalls: ty.q('one'), restDays: ty.q('days') },
  writableBy: { stalls: ['session'], restDays: ['session', 'owner'] },
  nouns: { stalls: 'sessions in a row without progress', restDays: 'rest days between workouts' },
  init: () => ({ stalls: q(0, 'x'), restDays: days(4) }),
  on: { session: (c) => c.commit({
    stalls:   iff(c.ev.hitAll(undefined, 'top'), q(0, 'x'), add(c.s.stalls, q(1, 'x'))),
    restDays: iff(ge(c.s.stalls, q(1, 'x')), min(add(c.s.restDays, days(1)), days(7)), c.s.restDays),
  }) },
},
frequency: [minGap(any(), self('restDays'), 7)],
```

The commit is training-caused, so L13 is not involved. At prescribe on Monday, with the last workout on Friday and `restDays = 5`, the verdict is `early { dueOn: Wednesday }`.

- **Prose.** "Rest today. Your next workout is due Wednesday: at least 5 rest days between workouts, never more than 7 (the rest grows by a day each time you go 2 sessions in a row without progress)."
- **Starting anyway.** If the user starts anyway, the occurrence records `startedEarly`, and nothing else changes.

### 4.4 "48 h between hard runs"

```ts
slots: { intervals: …({ tags: ['hard'] }), tempo: …({ tags: ['hard'] }), long: …({ tags: ['hard'] }), easy: … },
frequency: [minGap(tag('hard'), days(2), 2)],
```

- **Prose.** "Leave at least 2 days between hard runs (intervals, tempo or long run)."
- **Feasibility.** The checker proves this together with the rotation. Three hard runs per 7 days with gaps of 2 fit (days 0, 2, 4). Four hard runs fit (0, 2, 4, 6). Five are refused as `infeasibleFrequency` with the conflicting pair named.
- **Granularity.** The language counts calendar days, not hours. A Monday-evening run followed by a Wednesday-morning run satisfies "2 days" at about 36 hours. That is the honest reading of how the corpus sources apply the rule, and hour arithmetic is out (section 5).

### 4.5 A PT protocol, 3 times a day

```ts
rotation: daily(['ecc'], 3),                       // "Do Eccentric Heel Drops 3 times every day."
// default frequency: atLeast(3, any, day())       // "at least 3 sessions each day"
slots: { ecc: heelDrop.bind({ base: … }, { muscles: { calves: 1 } }) },
// inside the scheme's plan: progression by calendar day, not by session count
// perDay: q[reps/day], a dimension the IR's exponent vectors already admit
reps: exactly(add(c.p.base, mul(c.p.perDay, named('days into the protocol', c.cal.day)))),
```

- **Expectations.** One window per day, so adherence reads "Tuesday: 2 of 3 sessions (1 missed)". The memo commits to counts, not morning or evening identity, because sub-day slots are scheduling.
- **Day clock.** `cal.occurrence` tells the plan which session of the day it is. A protocol that wants "the evening session is lighter" can write `iff(ge(c.cal.occurrence, q(3,'x')), …)`.
- **Per-day progression.** Post-THR "a little further each day" reads `cal.day` (T9). `slotSession` would over-count at 3 sessions a day and under-count on missed days.
- **Pain gates.** They are amendment F's `pain` scale and are unchanged by time.

### 4.6 A paused program

1. 5/3/1 under `slide`, mid-cycle. The owner pauses from 20 Oct to 30 Oct.
2. Every week window touching 20 to 30 Oct is issued `void`. Prose: "Paused 20 to 30 October. Paused weeks don't count toward attendance."
3. The progress clock does not move, so no weekEnd or cycleEnd fires and no TM bump happens.
4. `cal.gap` keeps counting.

A layoff rule (StrongLifts) is a plan read, and the handler judges progress against the stamp:

```ts
plan: (c) => iff(ge(orElse(c.cal.gap(slotSel('squat')), days(0)), days(14)), scaleLoad(base, pct(90)), base),
on: { session: (c) => c.commit({ load: add(orElse(c.ev.prescribed('work', 'load'), c.s.load), c.p.inc) }) },
```

- **Prose.** "If it has been 14 days or more since your last squat session, use 90% of the load."
- **Why it is safe.** The handler bumps from the ISSUED load, so the resumed session progresses from 90%. No time-caused commit was needed, and replay reproduces it because the gap was stamped on the issued session.
- **Anchored drift.** The same pause under a `peakOn` meet prep skips the paused weeks, because the meet does not move. The pause confirmation copy says so before the owner commits.
- **Lapse.** If the owner had never paused and simply stopped, the instance would lapse after 21 days with the same voiding from that day. The next session resumes it.

## 5. What stays out, and why

- **Wall-clock scheduling.** Hours, "every 2 hours", GTG spread timing, AM/PM identity and hour-exact "48 h". No progression rule in 116 programs needs hour arithmetic. Every hour-level demand in the corpus is a reminder cue. Day granularity plus `occurrence` order covers the training logic.
- **Timezone pathologies.** Travel across zones, DST and two sessions landing on one local day. The boundary stamps `localDay` once at session start and never revisits it. A flight can make two sessions share a day or leave a day empty. That is accepted as what the athlete's own calendar said. The language never sees a zone.
- **Notification timing.** When to nudge, push permission and "due today" banners. `program_days.weekdays` stays a UX hint that feeds the home anchor and `asScheduled` projection, never expectations. Notifications are deferred and gesture-gated per the recorded plan.
- **ACWR, EWMA, CTL/ATL/TSB, NP, time-in-zone.** These are fitted or stream models. A boundary service publishes them as inputs stamped on `observedOn`. `cal.recent` deliberately offers only count, sum and max with literal bounds.
- **Automatic weekday assignment, and moving a workout to another day.** Never. This is the provenance law.
- **Streaks and gamification.** Derivable views over adherence facts, outside the language.
- **Dynamic tags** ("a run is hard when its pace is under X"). Tags are static slot metadata. A dynamic tag would make feasibility unprovable and prose conditional.
- **Rolling `atLeast` expectations.** Rejected in 2.4 because misses would not be countable.

## 6. Cost

### Checker

Adds:
- One capability, `cal`, in the position-grant table.
- One dimension, `day`, and one former, `cal`.
- A `cadence` position.
- Selector resolution against slots, days, muscles and tags (`unknownName`).
- A bounded feasibility search over literal frequency sets.
- Rest-ownership checks for groups.

New refusals:
- `infeasibleFrequency { a, b }`.
- `timeCommit` (a `periodClosed` handler that commits).
- `anchoredRequired` (`peakOn` under `slide`).
- `restOwnedByGroup`.
- `windowTooLong` (`recent` days > 56). `boundNotLiteral` is reused for non-literal days and ceilings.

Describers:
- 4 `CalQuery` forms and 5 selectors.
- 3 frequency forms.
- 2 rotation variants and 2 drift modes.
- 5 group forms (closing the D1 hole).
- `Due`, `Expectation`, `Adherence` and amendment renders.
- 4 lifecycle events.

`DESCRIBERS` stays a mapped type, so a missing entry still fails to compile. Declarations get the same treatment via a `DECL_DESCRIBERS` table keyed by `Frequency['k'] | Rotation['k'] | Group['k']`.

### Engine laws

- **L5 Idempotence, amended.** Reconciliation is a set of per-day causeKeys. Expectations and adherence are keyed by `(instance, rule, window)`. Progress events are emitted atomically with the closure that causes them.
- **L6 Facts, amended.** Expectations, due verdicts and adherence are issued facts. Late occurrences append amendments, and nothing is edited.
- **L9 Honest projection, amended.** `asScheduled` lays sessions on nominal days, so projection can answer "at 3 a week this block ends 20 Dec". It is tagged projected and never writes the ledger.
- **L11 Training causes progress (new).** Progress clocks advance only on closed training, an owner skip, or an `anchored` week end. A slot boundary handler with no completed session of that slot in its window records `keep(untrained)`.
- **L12 Stamped time (new).** No term reads the wall clock. Every calendar read evaluates at a stamped `LocalDay`, and its value is stamped on the fact it produced.
- **L13 Time alone never commits (new).** Handlers on calendar-caused events (`periodClosed`, lapse) may only propose or keep. A commit needs a training occurrence or the owner.

### Test plan

These rows resolve the open ones:
- EC-166 resolves via L11.
- BV-32 and BV-33 resolve via atomic progress events.
- EC-161 resolves via `programComplete`.
- EC-173 resolves via per-day causeKeys.

New equivalence classes:
- **EC-T01 to EC-T08 (static).**
  - Dimension separation: days with weeks, days with seconds, `rest: days(2)`.
  - A `cal` read in a fn body, init or binding is `capabilityEscape`.
  - `recent` with non-literal or more than 56 days.
  - A `periodClosed` commit is `timeCommit`.
  - Infeasible literal sets.
  - `peakOn` under `slide`.
  - Member rest in a group.
  - Unknown selector.
- **EC-T09 to EC-T21 (runtime).**
  - Reconcile twice.
  - Crash mid catch-up.
  - Progress closure atomic with the final session.
  - An untrained boundary keeps.
  - A late session appends an amendment.
  - A mid-window schedule edit leaves the current expectation alone.
  - A pause voids a window.
  - Lapse and resume.
  - An early start counts and is flagged.
  - An empty session never counts toward an expectation or `gap`.
  - A late `peakOn` activation skips with `startedLate`.
  - Ad-hoc sessions are invisible.
  - `asScheduled` projection is honest.

Boundaries:
- **BV-T01 to BV-T07.** Day 6 versus day 7 of an instance week. Gap exactly n. The n-th versus (n+1)-th session under `atMost`. `recent` at 1 and at 56 days. Gap with no prior session. A gap term above its ceiling. Lapse at exactly `lapseAfterDays`.
- **BV-T08 to BV-T14.** A one-day pause and an open-ended pause. `occurrence` at perDay and perDay + 1. A session that crosses midnight. A day stamp two days off its instant (refused). The `dueOn` search at its bound. Prescribe after the end. Day 0 issuance.

### Migration

- `workouts` gains `local_day date NOT NULL` for new rows, stamped by the client at session start. History is backfilled from `started_at` using the zone the client reports at its first post-migration launch, with a `local_day_inferred` flag. That is a guess, labeled as one, and "today's label is not evidence of yesterday's" stays honored.
- Expectations are never issued for days before an instance's activation. Inferred days therefore affect only early `gap` and `recent` reads, and never adherence.
- `programWeek` keeps meaning the progress week. That is already the completed-only semantics.
- The instance anchor and status become columns on the block entity (one entity per block).
- The imported Volume Cut program (SYN Q1) activates on import day with `slide` drift and the rotation-derived default frequency. Its first window opens the next week start.

## Open product calls

1. **Do missed sessions feed progression?** The recommended default is no. Adherence is a fact for display, exports and `periodClosed` proposals only. `hitAll` and `missedAny` never see an unperformed session as a failed one, and no library program proposes a regression from non-attendance. Should the app ever auto-propose a regression after missed weeks, for example a TM cut after two empty weeks, or is that always the layoff rule at the next session?
2. **Pause granularity.** The recommendation voids any window that touches a paused day. The alternative prorates the expectation. Proration produces fractional sessions and surprising prose, but voiding forgives a whole week for a one-day pause.
3. **Lapse threshold.** The default is 21 days. Lapse stops misses from accruing on a program the user has silently left. Should a lapse also prompt "archive this program?"
4. **Ad-hoc workouts and the program clock.** They are excluded by provenance. Physiologically, an ad-hoc squat session does reset detraining. Should `cal.gap` alone (not adherence) count ad-hoc sessions that train the selector's muscles?
5. **Clinical hard gates.** The due verdict is soft everywhere. A clinician-authored rehab program might want "cannot start before day 3" to be a hard refusal. That would be the only place the app blocks the athlete.
