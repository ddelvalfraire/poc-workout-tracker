# Intensity techniques: plan → logger

Research and design for making `technique` (drop-set / rest-pause / myo-reps /
cluster) a fact the app can actually *run*, not just store.

Status: **design, not built.** Branch `feat/technique-logging`, cut from `main`.

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

## Sources

- Hevy, [Workout Set Types](https://www.hevyapp.com/features/workout-set-types/)
  and [How to change the set type](https://www.hevyapp.com/help/change-the-set-type/)
- Hevy, [What Is a Drop Set](https://www.hevyapp.com/what-is-a-drop-set/)
