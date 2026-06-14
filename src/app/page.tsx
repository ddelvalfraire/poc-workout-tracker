import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { requireUserId } from "@/lib/auth";
import { listWorkoutSummaries } from "@/db/workouts";
import { formatWorkoutDate } from "@/lib/format";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default async function HomePage() {
  const userId = await requireUserId(); // middleware also guards; this is defense-in-depth
  const summaries = await listWorkoutSummaries(userId);

  return (
    <main className="mx-auto w-full max-w-md p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Workout Tracker</h1>
        <UserButton />
      </header>
      <Link href="/workout/new" className={cn(buttonVariants(), "mt-8 w-full")}>
        + Start Workout
      </Link>

      <h2 className="mt-8 text-sm font-medium text-muted-foreground">History</h2>
      {summaries.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No workouts yet — start your first one.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {summaries.map((w) => (
            <li key={w.id}>
              <Link
                href={`/workout/${w.id}`}
                className="block rounded-xl transition-colors hover:bg-muted/40"
              >
                <Card size="sm">
                  <CardHeader>
                    <CardTitle className="text-base">{w.name ?? "Workout"}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {formatWorkoutDate(w.startedAt)} · {w.exerciseCount} exercise
                    {w.exerciseCount === 1 ? "" : "s"} · {w.setCount} set
                    {w.setCount === 1 ? "" : "s"}
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
