import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import { getWorkoutDetail } from "@/db/workouts";
import { formatWorkoutDate, formatSet } from "@/lib/format";
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
  const workout = await getWorkoutDetail(userId, id);
  if (!workout) notFound();

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
          {workout.exercises.map((exercise) => (
            <section
              key={exercise.id}
              className="rounded-2xl border border-border bg-card p-4"
            >
              <h2 className="text-base">{exercise.name}</h2>
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
                        {formatSet(set.reps, set.weight)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          ))}
        </div>

        <WorkoutActions id={workout.id} />
      </main>
    </div>
  );
}
