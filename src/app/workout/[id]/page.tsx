import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { getWorkoutDetail, getExerciseHistoryBefore } from "@/db/workouts";
import { getWeightUnit } from "@/db/preferences";
import {
  formatWorkoutDate,
  formatLoggedSet,
  formatE1RM,
  formatVolume,
  formatWorkoutDuration,
} from "@/lib/format";
import { bestSet, estimate1RM } from "@/lib/one-rep-max";
import { AppHeader } from "@/components/app-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WorkoutActions } from "./workout-actions";

export default async function WorkoutDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await requireUserId();
  const { id } = await params;
  const [workout, unit] = await Promise.all([
    getWorkoutDetail(userId, id),
    getWeightUnit(userId),
  ]);
  if (!workout) notFound();

  const exerciseIds = [
    ...new Set(workout.exercises.map((e) => e.wgerExerciseId)),
  ];
  const history = await getExerciseHistoryBefore(
    userId,
    exerciseIds,
    workout.startedAt,
  );
  const priorByExercise = new Map<
    number,
    { reps: number | null; weight: number | null }[]
  >();
  for (const row of history) {
    const list = priorByExercise.get(row.wgerExerciseId) ?? [];
    list.push({ reps: row.reps, weight: row.weight });
    priorByExercise.set(row.wgerExerciseId, list);
  }

  // A PR is a property of the exercise + workout, not a single card: an exercise
  // logged in more than one card is judged by its best set across the whole
  // workout, and the badge renders once — on the first card for that exercise.
  const currentByExercise = new Map<
    number,
    { reps: number | null; weight: number | null }[]
  >();
  for (const ex of workout.exercises) {
    const list = currentByExercise.get(ex.wgerExerciseId) ?? [];
    for (const s of ex.sets) list.push({ reps: s.reps, weight: s.weight });
    currentByExercise.set(ex.wgerExerciseId, list);
  }
  const prBadgeRowIds = new Set<string>();
  const decidedExercises = new Set<number>();
  for (const ex of workout.exercises) {
    if (decidedExercises.has(ex.wgerExerciseId)) continue;
    decidedExercises.add(ex.wgerExerciseId);
    const cur = bestSet(currentByExercise.get(ex.wgerExerciseId) ?? []);
    const pri = bestSet(priorByExercise.get(ex.wgerExerciseId) ?? []);
    if (cur !== null && pri !== null && cur.e1rm > pri.e1rm) {
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

        <div className="mt-4 space-y-3">
          {workout.exercises.map((exercise) => {
            const current = bestSet(exercise.sets);
            // The top set (highest e1rm) gets marked — but only when there's a
            // comparison to make; a lone set being "best" is noise.
            const bestIndex =
              current && exercise.sets.length > 1
                ? exercise.sets.findIndex(
                    (s) => estimate1RM(s.reps, s.weight) === current.e1rm,
                  )
                : -1;
            const isPR = prBadgeRowIds.has(exercise.id);

            return (
              <section
                key={exercise.id}
                className="rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="min-w-0 text-base">{exercise.name}</h2>
                  {isPR && (
                    <span
                      aria-label="Personal record"
                      className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground"
                    >
                      PR
                    </span>
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
                          {formatLoggedSet(set, unit)}
                        </span>
                        {setIndex === bestIndex && (
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                            Top set
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {current && (
                  <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Est. 1RM
                    </span>
                    <span className="font-display text-2xl leading-none tnum">
                      <span aria-hidden="true" className="text-muted-foreground">
                        ~
                      </span>
                      {formatE1RM(current.e1rm, unit)}
                    </span>
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
