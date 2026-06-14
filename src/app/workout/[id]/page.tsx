import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import { getWorkoutDetail } from "@/db/workouts";
import { formatWorkoutDate, formatSet } from "@/lib/format";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <main className="mx-auto w-full max-w-md p-6">
      <header className="flex items-center justify-between">
        <Link
          href="/"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          ← Back
        </Link>
        <h1 className="text-xl font-semibold">{workout.name ?? "Workout"}</h1>
      </header>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatWorkoutDate(workout.startedAt)}
      </p>

      <div className="mt-6 space-y-4">
        {workout.exercises.map((exercise) => (
          <Card key={exercise.id}>
            <CardHeader>
              <CardTitle className="text-base">{exercise.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {exercise.sets.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sets logged.</p>
              ) : (
                exercise.sets.map((set) => (
                  <div key={set.id} className="flex items-center gap-3 text-sm">
                    <span className="w-12 text-muted-foreground">
                      Set {set.setNumber}
                    </span>
                    <span>{formatSet(set.reps, set.weight)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <WorkoutActions id={workout.id} />
    </main>
  );
}
