import Link from "next/link";
import { ChevronRight, RotateCcw } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { requireUserId } from "@/lib/auth";
import { listWorkoutSummaries } from "@/db/workouts";
import { listWorkoutDrafts } from "@/db/workout-drafts";
import { getNextProgramDay } from "@/db/programs";
import { getWeightUnit, getBodyweightKg } from "@/db/preferences";
import { kgToDisplay } from "@/lib/units";
import { pickActiveSession } from "@/lib/active-session";
import { formatWorkoutDate, formatVolume, formatWorkoutDuration } from "@/lib/format";
import { startedWithinLastHours } from "@/lib/recent-window";
import { buttonVariants } from "@/components/ui/button";
import { UnitToggle } from "@/components/unit-toggle";
import { BodyweightEditor } from "@/components/bodyweight-editor";
import { cn } from "@/lib/utils";
import { NextWorkoutCard } from "./next-workout-card";
import { ResumeSessionCard } from "./resume-session-card";
import { TodayWorkouts } from "./today-workouts";

export default async function HomePage() {
  const userId = await requireUserId(); // middleware also guards; this is defense-in-depth
  const [summaries, unit, bodyweightKg, nextDay, drafts] = await Promise.all([
    listWorkoutSummaries(userId),
    getWeightUnit(userId),
    getBodyweightKg(userId),
    getNextProgramDay(userId),
    listWorkoutDrafts(userId),
  ]);
  // A fresh draft IS an in-progress session (the logger autosaves one on
  // every change; saving deletes it) — surface it as the resume banner.
  const activeSession = pickActiveSession(drafts, new Date());

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-safe pt-safe backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-5 pb-3">
          <h1 className="text-2xl font-bold uppercase tracking-tight">Workout Tracker</h1>
          <div className="flex items-center gap-2">
            {/* Bodyweight sits with the unit toggle: both are the same kind of
                lightweight measurement preference, and BW-type exercises need
                it before they can score an estimated 1RM. */}
            <BodyweightEditor
              bodyweightDisplay={bodyweightKg !== null ? kgToDisplay(bodyweightKg, unit) : null}
              unit={unit}
            />
            <UnitToggle unit={unit} />
            <UserButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {activeSession && <ResumeSessionCard session={activeSession} />}

        {/* One volt CTA per screen: with a live session above, the next-day
            card's start button demotes to outline. */}
        {nextDay && <NextWorkoutCard next={nextDay} demoted={Boolean(activeSession)} />}

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
              // gap-1 gives the Repeat link's expanded hit inset dead space
              // to land in — without it the inset overlaps the row link.
              <li key={w.id} className="flex items-center gap-1">
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
                  <ChevronRight
                    aria-hidden="true"
                    className="size-5 shrink-0 text-muted-foreground"
                  />
                </Link>
                <Link
                  href={`/workout/new?from=${w.id}`}
                  aria-label={`Repeat ${w.name ?? "Workout"}`}
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "icon-sm" }),
                    // Invisible inset lifts the 36px visual button toward the
                    // 44px HIG target without growing the row.
                    "relative mr-2 shrink-0 text-muted-foreground before:absolute before:-inset-1",
                  )}
                >
                  <RotateCcw aria-hidden="true" className="size-5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
