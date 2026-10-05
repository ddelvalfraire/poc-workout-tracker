# Brief: time as a first-class citizen of the training algebra

## The owner's ask (verbatim gist)

Programs specify X workout days per week, or rolling-window frequency ("hit legs 3 times in 7 days"). The app should later derive adherence facts like "missed one workout in the program's last week" for ANY program calendar. We need to consider: time bounds for programs, rest days, rest time between sets, supersets, and whatever else. "Holistically, time should be first class maybe."

## What the algebra has today (synthesis package, scratchpad/arena2/synthesis/)

- Clocks: `pos.week`, `pos.trainWeek`, `pos.role`, `pos.slotSession`. All BLOCK-RELATIVE counters. No dates, no elapsed time, no day index, no time of day.
- `Calendar { weeks: WeekRole[], repeat }` + `Rotation { weekly | alternate(perWeek) }`: the week is the only grid; days are named slots in a rotation, not time points.
- `restSec` on a set; `superset(rest)` / `circuit(restBetweenRounds)` / `emom(every)` / `amrapFor(cap)` groups carry their own clocks as data; groups are currently unchecked and undescribed (uncommon-slice finding).
- Schedules indexed by trainWeek or slotSession. Macro `Exit`: fixed weeks / bounded weeks by predicate / open; `peakOn(date)` exists only as a macro anchor string.
- Triggers: session, weekEnd, cycleEnd, blockEnd. Nothing fires on a day boundary, an elapsed gap, or a missed expectation.
- Events are things that HAPPENED. There is no representation of a session that was EXPECTED and did not happen. "Missed a workout" is not derivable; only "sessions that occurred" exist.

## Accumulated demands (from the interrogation, the corpus slices, and the test plan; all in scratchpad/arena2 reviews + scratchpad/corpus/)

Frequency and adherence:
- Per-week day counts (almost every program: "3 days/week").
- Rolling-window frequency: "legs 3x in any 7 days" (owner), PT protocols "3x/day" (Alfredson 180 reps/day), grease-the-groove (many spread sets per day), 100-pushups-daily streaks.
- Adherence derivation for ANY calendar: "missed one workout last week", completed-fraction exports (cross-program seed channel wants `completedFraction`).
- Mentzer: rest DAYS between sessions grow when you stall (cadence driven by state, the hypertrophy slice's only model break).
- StrongLifts layoff rule / detraining: "14+ days off → restart at 90%" needs days-since-last-session.
- "48 h between hard runs" spacing constraints (cardio).

Windows and history:
- Rolling 4-week window (long-run safety rule), 7-day acute loads, HRV baselines: the `lastN`/ring open question.
- ACWR-style acute:chronic ratios named as boundary-service territory, but the WINDOW primitive question remains.

Intra-day and sub-day:
- GTG spread sets through a day; PT 3x/day; two-a-days. No sub-day clock exists.
- EMOM / time caps / density (EDT): group clocks exist as data but unchecked, undescribed, unscored (time-for-fixed-work is the model-change line).

Calendar truth:
- Test-plan dangers: calendar catch-up driven by dates bumps TMs with zero training (EC-166); deferPastDeload stale-TM issuance; the week grid advances regardless of adherence.
- The app today: `workouts` have real dates; `program_days.weekdays[]`; provenance law (completed-only counting, resume-on-start); one-entity-per-block.
- Dates: peak-to-date, `Exit.date` semantics unspecified (round-2 open item), taper to race day.

Rest semantics:
- restSec is a set field; recovery intervals as TARGETS (walk/jog with their own metric targets) wanted by cardio; rest DAYS as first-class (Mentzer, PT); rest between superset members vs after the pair (NASM, round-1 stress test).

## The design questions the memo must answer

1. What is the TIME MODEL? Candidate shape: (a) block-relative counters only (status quo); (b) a day-indexed calendar under the week grid (every program instance gets a concrete day timeline; sessions attach to days; expectations exist); (c) full wall-clock (dates, hours). Where is the line, and what does each scope read?
2. EXPECTATION vs OCCURRENCE: to derive "missed", the system must know what was planned for a window. Where does the expectation live (calendar? rotation? a frequency CONSTRAINT sort?), who evaluates it, and when does "missed" become a fact (a dayEnd/weekEnd reconciliation event?). Interaction with the provenance law (completed-only counting) and idempotent ledger.
3. FREQUENCY CONSTRAINTS as declarations: "3x/week", "3x per rolling 7 days", "at least 48h between hard sessions", "no more than 2 consecutive days". Are these (a) checker-time constraints on the calendar data, (b) runtime gates at prescribe, (c) advisory facts? What is their prose?
4. CADENCE-DRIVEN-BY-STATE (Mentzer, autoregulated deload timing): does the calendar become a function of state (big change), or is cadence a per-slot "next session not before" fact the scheduler reads (smaller)? 
5. REST at each scope: set restSec (exists), recovery steps with targets (metric registry fix), inter-session spacing, rest days, deload weeks (exist). One coherent story, with describers.
6. WINDOWS: does a bounded rolling-window read over the ledger/sessions enter the language (`inLastDays(n)` aggregates with literal n), or stay boundary-derived facts? Recall totality + describability laws; the corpus found state-as-ring "possible but clunky and opaque to prose".
7. TIME BOUNDS for programs: program duration today = calendar length; bounded macro phases exist; what else does "time bounds" need (deadlines, expiry, pause/vacation semantics, program pause vs abandon)?
8. What does this mean for the AMENDMENT LIST already open (metric registry, policy former, event input snapshots, exports/seed, units incl. pace, repeat blocks, groups checked+described)? Time changes should compose with those, not fork them.

## Constraints carried (non-negotiable)

Totality (literal bounds on any window), describability (every time construct has prose: "at least 48 hours after your last hard run"), silence over corruption, idempotent caused transitions, issued prescriptions immutable, the provenance law (never reassign a workout's day; completed-only counting), replay determinism (time reads must be stamped like inputs, or the ledger lies).

## Sources to read

- scratchpad/arena2/synthesis/ (algebra.ts, structure.ts, engine.ts, rationale.md)
- scratchpad/arena2/synthesis-note.md
- scratchpad/corpus/slice-strength.md, slice-hypertrophy.md, slice-cardio.md, slice-uncommon.md, test-plan.md, and slice-research-pt.md IF it exists by the time you read (a PT-focused worker may still be writing it; its per-day frequency and time-floor findings matter here; note its absence honestly if missing).
- App context read-only: /Users/daviddelval/code/github.com/ddelvalfraire/poc-workout-tracker src/db/schema.ts (workouts dates, program_days.weekdays), the provenance memory is summarized above.
