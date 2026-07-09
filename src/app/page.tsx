import Link from "next/link";
import { ChevronRight, RotateCcw, Settings } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { requireUserId } from "@/lib/auth";
import { listWorkoutSummaries } from "@/db/workouts";
import { listWorkoutDrafts } from "@/db/workout-drafts";
import { getNextProgramDay } from "@/db/programs";
import { getWeightUnit } from "@/db/preferences";
import { resolveActiveSession } from "@/lib/active-session";
import { formatVolume, formatWorkoutDuration } from "@/lib/format";
import { startedWithinLastHours, completedWithinLastHours } from "@/lib/recent-window";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NextWorkoutCard } from "./next-workout-card";
import { ResumeSessionCard } from "./resume-session-card";
import { TodayWorkouts } from "./today-workouts";

// en-US matches formatWorkoutDate — one locale for all date display.
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short" });

export default async function HomePage() {
  const userId = await requireUserId(); // middleware also guards; this is defense-in-depth
  const [summaries, unit, nextDay, drafts] = await Promise.all([
    listWorkoutSummaries(userId),
    getWeightUnit(userId),
    getNextProgramDay(userId),
    listWorkoutDrafts(userId),
  ]);
  // A fresh draft IS an in-progress session (the logger autosaves one on
  // every change; saving deletes it) — and a started-but-unfinished workout
  // is one too, even before its first edit (starting a program day creates
  // the row immediately). Drafts win: they carry unsaved sets.
  const now = new Date();
  const activeSession = resolveActiveSession(drafts, summaries, now);
  // "Already trained today" (12h completion window, same rhythm as the
  // session TTL): once a session is finished — or one is live — the day's
  // marching orders are done and the Up-next hero stands down; the Quick Log
  // and Programs shortcuts below stay.
  const showNextDay =
    Boolean(nextDay) && !activeSession && !completedWithinLastHours(summaries, 12, now);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-safe pt-safe backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-5 pb-3">
          <h1 className="text-2xl font-bold uppercase tracking-tight">Workout Tracker</h1>
          <div className="flex items-center gap-2">
            {/* Preferences live on /settings now — the header keeps only
                identity and the door to them. */}
            <Link
              href="/settings"
              aria-label="Settings"
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon-sm" }),
                "relative text-muted-foreground before:absolute before:-inset-1",
              )}
            >
              <Settings aria-hidden="true" className="size-5" />
            </Link>
            <UserButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {activeSession && <ResumeSessionCard session={activeSession} />}

        {showNextDay && nextDay && <NextWorkoutCard next={nextDay} />}

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
          // Completed only: a freshly-started session must never wear the
          // "Done today" checkmark — it's the live banner's job above.
          workouts={startedWithinLastHours(summaries, 48)
            .filter((w) => w.completedAt !== null)
            .map((w) => ({
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
                  // An unfinished session reopens the logger — the read-only
                  // summary would present it as a completed workout.
                  href={w.completedAt === null ? `/workout/${w.id}/edit` : `/workout/${w.id}`}
                  className="flex min-w-0 flex-1 items-center gap-4 px-4 py-3.5 transition-colors active:bg-muted/60"
                >
                  {/* Stacked calendar block: scanning history is a date
                      lookup first — give the eye a fixed tabular anchor
                      instead of burying the date mid-sentence. */}
                  <span className="flex w-9 shrink-0 flex-col items-center">
                    <span className="font-display text-xl leading-none tnum">
                      {w.startedAt.getDate()}
                    </span>
                    <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {monthFormat.format(w.startedAt)}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate font-medium">{w.name ?? "Workout"}</span>
                      {w.completedAt === null && (
                        <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary">
                          In progress
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-muted-foreground tnum">
                      {[
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
