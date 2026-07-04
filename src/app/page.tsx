import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { requireUserId } from "@/lib/auth";
import { listWorkoutSummaries } from "@/db/workouts";
import { getNextProgramDay } from "@/db/programs";
import { getWeightUnit } from "@/db/preferences";
import { formatWorkoutDate, formatVolume, formatWorkoutDuration } from "@/lib/format";
import { startedWithinLastHours } from "@/lib/recent-window";
import { buttonVariants } from "@/components/ui/button";
import { UnitToggle } from "@/components/unit-toggle";
import { cn } from "@/lib/utils";
import { NextWorkoutCard } from "./next-workout-card";
import { TodayWorkouts } from "./today-workouts";

export default async function HomePage() {
  const userId = await requireUserId(); // middleware also guards; this is defense-in-depth
  const [summaries, unit, nextDay] = await Promise.all([
    listWorkoutSummaries(userId),
    getWeightUnit(userId),
    getNextProgramDay(userId),
  ]);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-safe pt-safe backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-5 pb-3">
          <h1 className="text-2xl font-bold uppercase tracking-tight">Workout Tracker</h1>
          <div className="flex items-center gap-2">
            <UnitToggle unit={unit} />
            <UserButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {nextDay && <NextWorkoutCard next={nextDay} />}

        {/* With a program driving the day, freestyle logging demotes to a
            secondary action; without one it stays the primary CTA. */}
        {nextDay ? (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Link
              href="/workout/new"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "font-semibold uppercase tracking-wide",
              )}
            >
              Quick Log
            </Link>
            <Link
              href="/programs"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "font-semibold uppercase tracking-wide",
              )}
            >
              Programs
            </Link>
          </div>
        ) : (
          <>
            <Link
              href="/workout/new"
              className={cn(
                buttonVariants({ size: "lg" }),
                "mt-6 w-full text-base font-semibold uppercase tracking-wide",
              )}
            >
              + Start Workout
            </Link>

            <Link
              href="/programs"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "mt-3 w-full text-base font-semibold uppercase tracking-wide",
              )}
            >
              Programs
            </Link>
          </>
        )}

        <TodayWorkouts
          // A 48h window (not a row cap) so "today" can never be crowded out
          // by backdated entries, while any client timezone's calendar day is
          // still fully covered; the exact local-day filter runs client-side.
          workouts={startedWithinLastHours(summaries, 48).map((w) => ({
            id: w.id,
            name: w.name,
            startedAt: w.startedAt,
          }))}
        />

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
              <li key={w.id} className="flex items-center">
                <Link
                  href={`/workout/${w.id}`}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-4 transition-colors active:bg-muted/60"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{w.name ?? "Workout"}</span>
                    <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                      {[
                        formatWorkoutDate(w.startedAt),
                        formatWorkoutDuration(w.startedAt, w.completedAt),
                        `${w.setCount} set${w.setCount === 1 ? "" : "s"}`,
                        w.volumeKg > 0 ? formatVolume(w.volumeKg, unit) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
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
                <Link
                  href={`/workout/new?from=${w.id}`}
                  aria-label={`Repeat ${w.name ?? "Workout"}`}
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "icon-sm" }),
                    "mr-2 shrink-0 text-muted-foreground",
                  )}
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
                    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                    <path d="M21 3v5h-5" />
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
