import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { requireUserId } from "@/lib/auth";
import { listWorkoutSummaries } from "@/db/workouts";
import { formatWorkoutDate } from "@/lib/format";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function HomePage() {
  const userId = await requireUserId(); // middleware also guards; this is defense-in-depth
  const summaries = await listWorkoutSummaries(userId);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-safe pt-safe backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-5 pb-3">
          <h1 className="text-2xl font-bold uppercase tracking-tight">Workout Tracker</h1>
          <UserButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <Link
          href="/workout/new"
          className={cn(
            buttonVariants({ size: "lg" }),
            "mt-6 w-full text-base font-semibold uppercase tracking-wide",
          )}
        >
          + Start Workout
        </Link>

        <h2 className="mt-10 mb-3 text-lg">History</h2>

        {summaries.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-12 text-center">
            <p className="font-medium">No workouts yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tap “Start Workout” to log your first session.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {summaries.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/workout/${w.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-4 transition-colors active:bg-muted/60"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{w.name ?? "Workout"}</span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">
                      {formatWorkoutDate(w.startedAt)} · {w.exerciseCount} exercise
                      {w.exerciseCount === 1 ? "" : "s"} · {w.setCount} set
                      {w.setCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="size-5 shrink-0 text-muted-foreground"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
