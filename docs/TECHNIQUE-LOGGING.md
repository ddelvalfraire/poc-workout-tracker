# Intensity techniques: plan → logger

Research and design for making `technique` (drop-set / rest-pause / myo-reps /
cluster) a fact the app can actually *run*, not just store.

Status: **built.** Model A, as recommended below. The gap section describes
what was true before; the "How it landed" section at the end records what
shipped and how the three open questions were settled.

## The gap we found

`techniqueSchema` (lib/program-input.ts) has existed since Phase 1: a versioned
`{ kind, stages[] }` tail on `program_sets`, where each stage carries
`{ loadKg?, reps?, restSec? }`. It round-trips through every write path —
upsert, patch, clone, adopt, share.

Nothing consumes it.

- **No branch on `kind`.** Grep for `'drop-set'`/`'rest-pause'`/`'myo-reps'`/
  `'cluster'` outside the schema, arbitraries and tests: zero hits. The
  discriminator is inert.
- **Plan page prints the raw enum.** `src/app/programs/[id]/page.tsx` renders
  `{group.set.technique.kind}` directly — an untranslated lowercase-hyphen
  string in a UI where every other label goes through next-intl. This is a
  live i18n bug today, independent of anything below.
- **The logger ignores it completely.** `technique` is absent from the entire
  `src/app/workout/new` surface. `workout-draft.ts` says it plainly: *"The
  draft UI only speaks working/warmup; backoff/amrap render as ..."*. The
  field is dropped at the plan→draft boundary.

Net effect: a program can prescribe a rest-pause set, the lifter sees the word
"rest-pause" on the plan page, and then gets a completely ordinary set row with
no stages, no intra-set rest, and no way to record what actually happened.

That is why the template canon does **not** author techniques yet. Authoring
Doggcrapp or myo-reps before this lands would ship a promise the app breaks.

## How the data model constrains the answer

`sets` (db/schema.ts) is **one flat row per set**: `reps`, `weight`, one
`rir`/`rpe`, plus the immutable `prescribed*` snapshot — under a
`unique(workout_exercise_id, set_number)` constraint with 1-based contiguous
numbering.

A technique set is one *prescription* with N *results*. Two ways to reconcile:

### Model A — stages become rows (recommended)

A rest-pause set instantiates as N `sets` rows, grouped by a new nullable
`technique_group` (+ `stage_index`), each row carrying real reps and load.

- Every existing consumer stays correct **for free**: e1RM, best-set,
  volume, plan-sync, the autoregulation stall rules, and the effort gate all
  read rows and keep working without learning a new shape.
- Matches how the industry already models it (see below), so it matches what
  users expect.
- Costs: set counts inflate in the UI (a 3-stage rest-pause reads as 3 rows),
  and grouping must be visible or the log looks like noise.

### Model B — stages inside one row

Add `stages jsonb` to `sets`.

- Keeps "one set" identity, and mirrors the plan side's shape exactly.
- But `reps`/`weight` on the row become ambiguous (which stage?), and **every**
  scoring consumer must learn the new shape or silently under-count. Against a
  codebase whose stated doctrine is *silence over corruption*, that blast
  radius is the argument against it.

**Take Model A.** The grouping column is cheap; the alternative quietly
corrupts every downstream number until each consumer is individually taught.

## What competitors do

[Hevy](https://www.hevyapp.com/features/workout-set-types/) models these as
**set types, not nested stages**:

- Tap the set number in the SET column → menu → `W` warm-up, `D` drop set,
  `F` to failure, or normal ([Hevy help](https://www.hevyapp.com/help/change-the-set-type/)).
- Each drop is **its own row**, tagged.
- The **rest timer is suppressed** when the next set is a drop set — because a
  drop set has no rest, and that is the whole point of the technique.

This is Model A with a set-type marker, and it independently validates the
recommendation.

## Why this is a small change for us

We already have the affordance. `SetRowMenu` (workout-logger.tsx ~2905) is
exactly Hevy's menu: it opens on the set row and already offers a warm-up tag,
dispatching `TAG_SET` with `nextSetTag()` — currently a 2-state toggle between
`working` and `warmup`.

The work is to widen that toggle into an n-way set-type picker and teach the
rest timer about zero-rest stages. Not a new surface.

### Sketch

1. **Draft** — extend `DraftSet` with an optional technique tag + group.
   Follow the established precedent stated in `workout-draft.ts`: *optional,
   absent = default*, so pre-technique drafts, payloads and fixtures stay
   valid **without a codec version bump** (the `rir`/`rpe`/`metricMode`/`note`
   precedent).
2. **Menu** — `nextSetTag()` becomes a picker; `TAG_SET` carries the chosen
   type. One new door, no new screen.
3. **Rest timer** — suppress between stages of the same group (Hevy's rule),
   and honour the plan's per-stage `restSec` for rest-pause/cluster, where the
   short intra-set rest *is* the prescription.
4. **Instantiation** — expand a planned `technique.stages[]` into N grouped
   rows, carrying each stage's `loadKg`/`reps` into the `prescribed*` snapshot.
5. **i18n** — translate `kind` on the plan page. Fix this first; it is a
   standing bug and a one-line-per-locale change.

### Open questions

- Should a technique group count as one set or N in "sets this week"? Volume
  landmarks (`weekly-volume`) count set rows, so Model A silently inflates MRV
  math. Probably needs the group to count as one — **decide before building.**
- Do myo-reps mini-sets deserve a distinct kind at the logger, or are they
  rest-pause with different stage params? The plan schema already separates
  them; the logger may not need to.
- Drop sets have no planned load until the lifter drops — is stage `loadKg`
  authored, or captured?

## How it landed

Five commits on `claude/technique-logging-255118`, in the order the sketch
proposed:

1. **i18n** — `ProgramDetail.day.technique.*` plus a shared kind → key map
   (`lib/technique.ts`). The standing bug, fixed first.
2. **Expansion** — `expandTechniqueStages` turns a prescription into stage
   rows; `sets` gains `technique_kind` / `technique_group` / `stage_index`
   (migration `0050_sets_technique_grouping`), all nullable. Instantiation
   AND the edit page's plan overlay call the same function, because plan
   targets are positional: a technique set that seeds 3 rows must offer 3
   targets or every later set wears the wrong ghosts and rest.
3. **Round trip** — `DraftSet.technique` / `SetInput.technique`
   (`{ kind, group, stageIndex }`, one object because the three facts are only
   ever true together), persisted like `metricMode` rather than restored from
   prior facts: a mid-session retag is the lifter's call. `parseWorkoutInput`
   refuses a group that is split, mixes kinds, skips a stage, or opens
   anywhere but stage 0 — and the draft renormalizes on every structural edit,
   so the UI can only produce shapes the wire accepts.
4. **Logger** — the set-row menu is now the n-way picker; a stage row wears
   its glyph, names itself to assistive tech, and shares a left hairline with
   its group. No rest period starts between stages.
5. **Volume** — the counting rule below.

### The open questions, settled

**Does a group count as one set or N?** Neither — it is WEIGHTED. Top stage
1.0, each later stage 0.5, applied on both the performed side
(`db/muscle-volume.ts`) and the planned side (`db/planned-volume.ts`) so
planned-vs-performed stays apples-to-apples.

Volume landmarks count hard sets as a proxy for stimulus *and* recoverable
fatigue, so both extremes are wrong: 3 rows would fire an MRV warning at a
third of the real dose, and 1 would under-credit work that is demonstrably
more than one set. The 0.5 rule reproduces what coaching practice already
estimates — a rest-pause set ≈ 2 straight sets (DC training, rest-pause
throughout, is programmed that way), a myo-rep set (activation + 3–5
mini-sets) ≈ 3, a drop set ≈ 2–3.

**Clusters are the exception** and count 1.0 whole, however many blocks: their
mini-sets are submaximal with real intra-set rest — the technique exists to
keep reps AWAY from failure — and the cluster literature counts a cluster as
one set by definition ("you still count that as one cluster set").

**Do myo-reps need a distinct kind at the logger?** No. The logger branches on
one thing only — is the next row in this group? — and the kind is a LABEL
(glyph, name, volume weight). Myo-reps and rest-pause differ in their stage
parameters, which the plan already carries.

**Is a drop's load authored or captured?** Both, and the schema already said
so: `stages[].loadKg` is optional. Authored → it seeds the row's
`prescribed_load_kg`; absent → the row starts blank and the lifter types what
they actually dropped to. An unauthored stage load is never inherited from the
top set, which would be a phantom prescription.

### The engine: what a technique set may testify to

Researched after the fact, and it changed the code. Every source describes
these methods as failure work: a drop set's top set goes "until technical
failure" before the first drop ([Hevy](https://www.hevyapp.com/what-is-a-drop-set/)),
and DC rest-pause is three failure sets inside one set. A per-set rep FLOOR is
therefore the wrong yardstick — the technique working exactly as intended
reads as a missed floor, and the auto-regulation stall rules would back the
lifter's load off for succeeding.

So **no row of a technique group testifies to auto-regulation**, top set
included (`db/autoreg-history.ts`). Ordinary sets in the same exercise still
do. The signal these methods actually progress on is the GROUP TOTAL — DC's
"beat the logbook" adds 5 lb once the three mini-sets total more than 15 reps
— and this engine does not compute totals yet. Until it does, silence beats a
wrong verdict; that predicate is the seam where total-reps scoring lands.

The one exception worth noting: a myo-reps ACTIVATION set is prescribed at
1–2 RIR, not to failure (going to failure there compromises the mini-sets), so
it is a scorable set in principle. It is excluded anyway — one rule for all
four kinds is easier to reason about than four, and the cost is silence, not a
wrong number.

### What is still open

- **Authoring.** Nothing in the app WRITES a technique yet except the MCP
  tools — the builder has no picker. The template canon can now author
  techniques (the promise is no longer broken), but a human editing a program
  in the UI cannot.
- **Total-reps progression** for rest-pause / myo-reps / drop sets — the
  "beat the logbook" rule above. Until it exists, a technique-only exercise
  simply gets no auto-regulation verdict.
- **History and share surfaces** render stage rows as ordinary sets: they are
  correct (every row is a real logged set) but they don't yet SHOW the
  grouping the logger does.

## Sources

- Hevy, [Workout Set Types](https://www.hevyapp.com/features/workout-set-types/)
  and [How to change the set type](https://www.hevyapp.com/help/change-the-set-type/)
- Hevy, [What Is a Drop Set](https://www.hevyapp.com/what-is-a-drop-set/)
- Hevy, [How many sets per muscle group](https://www.hevyapp.com/how-many-sets/)
- Chris Beardsley / cluster-set reviews on intra-set rest and why a cluster
  counts as one set
