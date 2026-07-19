import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { getWorkoutDetail, getExerciseHistoryBefore } from "@/db/workouts";
import { getNextProgramDay } from "@/db/programs";
import { getWeightUnit, getBodyweightKg } from "@/db/preferences";
import { resolveFinishUpNext } from "@/lib/finish-up-next";
import {
  formatWorkoutDate,
  formatLoggedSet,
  formatE1RM,
  formatVolume,
  formatWorkoutDuration,
} from "@/lib/format";
import { bestScoredSet } from "@/lib/one-rep-max";
import { AppHeader } from "@/components/app-header";
import { PrBadge } from "@/components/pr-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WorkoutActions } from "./workout-actions";
import { FinishUpNextCard } from "./finish-up-next-card";

export default async function WorkoutDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ finished?: string }>;
}) {
  const userId = await requireUserId();
  const [{ id }, { finished }] = await Promise.all([params, searchParams]);
  // Presentation-only flag set by the logger's finish push: it dresses the
  // page as the completion moment, nothing more. Shared/bookmarked URLs
  // without it get the plain summary; refreshing with it is harmless.
  const justFinished = finished === "1";
  // Bodyweight rides along with the unit: it's the load basis for any
  // bodyweight-type exercise's top-set/PR scoring below (null = rep fallback).
  const [workout, unit, bodyweightKg] = await Promise.all([
    getWorkoutDetail(userId, id),
    getWeightUnit(userId),
    getBodyweightKg(userId),
  ]);
  if (!workout) notFound();
  // Guard at the source, not just at every link site: this read-only summary
  // presents a workout as DONE (duration, PR badges, top sets). An unfinished
  // session reaching it by URL — bookmark, back/forward cache, hand-edited
  // path — belongs in the logger instead.
  if (workout.completedAt === null) redirect(`/workout/${id}/edit`);

  const exerciseIds = [
    ...new Set(workout.exercises.map((e) => e.wgerExerciseId)),
  ];
  // Up-next only matters at the finish moment, and only for a program
  // session — a quick log has no rotation to advance. Fetched alongside the
  // PR history read (independent queries).
  const [history, nextDay] = await Promise.all([
    getExerciseHistoryBefore(userId, exerciseIds, workout.startedAt),
    justFinished && workout.programDayId !== null
      ? getNextProgramDay(userId)
      : null,
  ]);
  const upNext = resolveFinishUpNext(workout.programDayId, nextDay);
  // Keyed by the composite identity: a custom exercise's id can collide with
  // a wger id, and the two must never share a PR baseline.
  const priorByExercise = new Map<
    string,
    { reps: number | null; weight: number | null }[]
  >();
  for (const row of history) {
    const key = `${row.source}:${row.wgerExerciseId}`;
    const list = priorByExercise.get(key) ?? [];
    list.push({ reps: row.reps, weight: row.weight });
    priorByExercise.set(key, list);
  }

  // A PR is a property of the exercise + workout, not a single card: an exercise
  // logged in more than one card is judged by its best set across the whole
  // workout, and the badge renders once — on the first card for that exercise.
  const currentByExercise = new Map<
    string,
    { reps: number | null; weight: number | null }[]
  >();
  for (const ex of workout.exercises) {
    const key = `${ex.source}:${ex.wgerExerciseId}`;
    const list = currentByExercise.get(key) ?? [];
    for (const s of ex.sets) list.push({ reps: s.reps, weight: s.weight });
    currentByExercise.set(key, list);
  }
  const prBadgeRowIds = new Set<string>();
  const decidedExercises = new Set<string>();
  for (const ex of workout.exercises) {
    const exKey = `${ex.source}:${ex.wgerExerciseId}`;
    if (decidedExercises.has(exKey)) continue;
    decidedExercises.add(exKey);
    // Prior sets are scored under the exercise's CURRENT logging type — the
    // history rows carry no type of their own, and comparing a pull-up's past
    // under today's reading is the comparison the lifter actually means.
    const cur = bestScoredSet(
      currentByExercise.get(exKey) ?? [],
      ex.loggingType,
      bodyweightKg,
    );
    const pri = bestScoredSet(
      priorByExercise.get(exKey) ?? [],
      ex.loggingType,
      bodyweightKg,
    );
    if (cur === null || pri === null) continue;
    // Like beats like: an e1rm PR needs a prior e1rm, a rep PR a prior rep
    // count. Mixed kinds (bodyweight set after weighted history) don't badge —
    // there's no honest axis to compare on.
    if (
      (cur.kind === "e1rm" && pri.kind === "e1rm" && cur.e1rm > pri.e1rm) ||
      (cur.kind === "reps" && pri.kind === "reps" && cur.reps > pri.reps)
    ) {
      prBadgeRowIds.add(ex.id);
    }
  }

  const totalSets = workout.exercises.reduce((n, e) => n + e.sets.length, 0);
  const volumeKg = workout.exercises.reduce(
    (sum, e) => sum + e.sets.reduce((s, set) => s + (set.reps ?? 0) * (set.weight ?? 0), 0),
    0,
  );
  const duration = formatWorkoutDuration(workout.startedAt, workout.completedAt);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={workout.name ?? "Workout"}
        leading={
          <Link
            href="/"
            aria-label="Back"
            className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "-ml-2")}
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {/* The completion moment: poster type over the stat row it crowns.
            The headline numbers stay in the dl below — one source, the
            heading just reframes them as the payoff. Volt rides the eyebrow
            and the PR chip (markers, not CTAs — the one-volt button rule
            is about actions and stays with WorkoutActions). */}
        {justFinished && (
          <section
            aria-label="Workout complete"
            className="mt-6 motion-safe:animate-rise-in"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              Session logged
            </p>
            <h2 className="mt-1 font-display text-4xl uppercase leading-none tracking-wide">
              Workout complete
            </h2>
            {prBadgeRowIds.size > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <PrBadge
                  label={
                    prBadgeRowIds.size === 1
                      ? "PR"
                      : `${prBadgeRowIds.size} PRs`
                  }
                />
                <p className="text-sm text-muted-foreground">
                  {prBadgeRowIds.size === 1
                    ? "New personal record this session"
                    : "New personal records this session"}
                </p>
              </div>
            )}
          </section>
        )}

        <div className="mt-4 flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {formatWorkoutDate(workout.startedAt)}
          </p>
          {workout.programWeek !== null && (
            <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-primary">
              Week {workout.programWeek}
            </span>
          )}
        </div>

        <dl className="mt-3 grid grid-cols-3 overflow-hidden rounded-2xl border border-border bg-card">
          <Stat label="Duration" value={duration ?? "—"} />
          <Stat
            label="Volume"
            value={volumeKg > 0 ? formatVolume(volumeKg, unit) : "—"}
          />
          <Stat
            label={totalSets === 1 ? "Set" : "Sets"}
            value={String(totalSets)}
          />
        </dl>

        {/* Session note under the stats — context for the numbers above. */}
        {workout.notes !== null && (
          <p className="mt-3 whitespace-pre-wrap rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
            {workout.notes}
          </p>
        )}

        {/* What comes after the finish: the next program day, or the block-
            complete banner when this session closed the mesocycle. Quick
            logs (upNext 'none') get just the celebration above. */}
        {justFinished && upNext.kind !== "none" && (
          <FinishUpNextCard state={upNext} />
        )}

        <div className="mt-4 space-y-3">
          {workout.exercises.map((exercise) => {
            // Scored under the exercise's logging type: highest e1rm over the
            // EFFECTIVE load, or the most-reps fallback when no set is
            // load-scorable (bodyweight work without a stored bodyweight, or
            // sets logged with no weight — "top set" must still resolve).
            // A skipped exercise earns no top-set/e1RM emphasis — nothing
            // was attempted, so there is nothing to celebrate.
            const current = exercise.skipped
              ? null
              : bestScoredSet(exercise.sets, exercise.loggingType, bodyweightKg);
            // The top set gets marked — but only when there's a comparison to
            // make; a lone set being "best" is noise.
            const bestIndex =
              current && exercise.sets.length > 1 ? current.index : -1;
            const isPR = prBadgeRowIds.has(exercise.id);

            return (
              <section
                key={exercise.id}
                className="rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  {/* Display type on the movement name: the card is a record
                      of work done under a bar — let it read like one. */}
                  <h2
                    className={cn(
                      "min-w-0 truncate font-display text-lg uppercase leading-tight tracking-wide",
                      exercise.skipped && "text-muted-foreground",
                    )}
                  >
                    {exercise.name}
                  </h2>
                  {exercise.skipped ? (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Skipped
                    </span>
                  ) : (
                    isPR && <PrBadge />
                  )}
                </div>
                {/* Set rows echo the logger's number circles (log → review
                    continuity) and run the values at glanceable scale; the top
                    set reads heavier than the rest. */}
                <div className="mt-3 space-y-2">
                  {exercise.sets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No sets logged.</p>
                  ) : (
                    exercise.sets.map((set, setIndex) => (
                      <div key={set.id} className="flex items-center gap-3">
                        <span
                          aria-label={`Set ${set.setNumber}`}
                          className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold tnum text-muted-foreground"
                        >
                          {set.setNumber}
                        </span>
                        <span
                          className={cn(
                            "tnum text-base",
                            setIndex === bestIndex
                              ? "font-semibold"
                              : "font-medium text-foreground/80",
                          )}
                        >
                          {formatLoggedSet(set, unit, exercise.loggingType)}
                        </span>
                        {setIndex === bestIndex && (
                          <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                            Top set
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {/* Per-exercise note under the set rows — the "why" behind
                    the numbers (or behind the skip). */}
                {exercise.notes !== null && (
                  <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                    {exercise.notes}
                  </p>
                )}
                {current && (
                  <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {current.kind === "e1rm" ? "Est. 1RM" : "Top set"}
                    </span>
                    {current.kind === "e1rm" ? (
                      <span className="font-display text-3xl leading-none tnum">
                        <span aria-hidden="true" className="text-muted-foreground">
                          ~
                        </span>
                        {formatE1RM(current.e1rm, unit)}
                      </span>
                    ) : (
                      // Rep fallback: no load to estimate from, but the best
                      // effort still deserves its readout — not a blank card.
                      <span className="font-display text-3xl leading-none tnum">
                        {current.reps} reps
                      </span>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <WorkoutActions id={workout.id} />
      </main>
    </div>
  );
}

/** One tile of the session stat row: big tabular value over a small label.
 *  DOM keeps the valid dt→dd order; flex-col-reverse renders value on top. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col-reverse border-l border-border px-4 py-3 first:border-l-0">
      <dt className="mt-0.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="tnum text-3xl font-semibold tracking-tight">{value}</dd>
    </div>
  );
}
