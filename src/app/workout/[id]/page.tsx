import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import { getWorkoutDetail, getExerciseHistoryBefore } from "@/db/workouts";
import { getWeightUnit } from "@/db/preferences";
import { formatWorkoutDate, formatSet, formatE1RM } from "@/lib/format";
import { bestSet } from "@/lib/one-rep-max";
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
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <p className="mt-4 text-sm text-muted-foreground">
          {formatWorkoutDate(workout.startedAt)}
        </p>

        <div className="mt-4 space-y-3">
          {workout.exercises.map((exercise) => {
            const current = bestSet(exercise.sets);
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
                <div className="mt-3 space-y-1.5">
                  {exercise.sets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No sets logged.</p>
                  ) : (
                    exercise.sets.map((set) => (
                      <div key={set.id} className="flex items-baseline gap-3 text-sm">
                        <span className="w-12 shrink-0 text-muted-foreground">
                          Set {set.setNumber}
                        </span>
                        <span className="tnum font-medium">
                          {formatSet(set.reps, set.weight, unit)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                {current && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Est. 1RM{" "}
                    <span className="tnum font-medium text-foreground">
                      <span aria-hidden="true">~</span>
                      {formatE1RM(current.e1rm, unit)}
                    </span>
                  </p>
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
