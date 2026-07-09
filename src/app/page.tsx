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
import { startedWithinLastHours } from "@/lib/recent-window";
import { buttonVariants } from "@/components/ui/button";
import { GuardedStartLink } from "@/components/guarded-start-link";
import { cn } from "@/lib/utils";
import { NextWorkoutCard } from "./next-workout-card";
import { ResumeSessionCard } from "./resume-session-card";
import { TodayWorkouts } from "./today-workouts";
import { TrainedTodayGate } from "./trained-today-gate";

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
  // Single-active-session guard: every "start something new" tap below gets
  // the live session (as the dialog's slim summary) so it can ask
  // continue-or-discard instead of silently stacking a second session.
  const guardSession = activeSession && {
    key: activeSession.key,
    name: activeSession.name,
    setCount: activeSession.setCount,
    completedSetCount: activeSession.completedSetCount,
  };
  // "Already trained today" is a LOCAL-calendar-day question the server
  // can't answer, so it moved client-side into <TrainedTodayGate> below. The
  // old 12h rolling window here suppressed the hero all morning after an
  // evening session — and discarding an in-progress workout didn't restore
  // it ("Right now it's cooked there is no hero card on my app"). The server
  // keeps only what it truly knows: a program day exists and no session is
  // live.
  const showNextDay = Boolean(nextDay) && !activeSession;
  // What the client gate needs: completion instants from the last 48h (same
  // window rationale as TodayWorkouts below — covers any timezone's "today"
  // without a row cap), as epoch ms for stable RSC serialization. The window
  // filters on COMPLETION time, not start time: a weeks-old Unfinished
  // session resumed and finished today must still count as trained-today.
  const GATE_WINDOW_MS = 48 * 60 * 60 * 1000;
  const recentCompletedAtTimes = summaries.flatMap((w) =>
    w.completedAt !== null && now.getTime() - w.completedAt.getTime() <= GATE_WINDOW_MS
      ? [w.completedAt.getTime()]
      : [],
  );
  // History is a record of finished sessions — an unfinished row wearing an
  // "In progress" chip there contradicts the definition (and duplicated the
  // live banner above). Unfinished rows get their own quiet section instead:
  // stale abandonments the user can resume or finish, not live state.
  const completed = summaries.filter((w) => w.completedAt !== null);
  const unfinished = summaries.filter((w) => w.completedAt === null);

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

        {/* The gate hides the hero client-side when a completion falls on the
            user's local today. Layout note: the two-button shortcut row below
            branches on nextDay only and is server-rendered regardless, so it
            still reads sensibly when the gate removes the hero — the grid
            simply becomes the top of the main column. */}
        {showNextDay && nextDay && (
          <TrainedTodayGate completedAtTimes={recentCompletedAtTimes}>
            <NextWorkoutCard next={nextDay} />
          </TrainedTodayGate>
        )}

        {/* With a program driving the day, freestyle logging demotes to a
            secondary action; without one it stays the primary CTA. */}
        {nextDay ? (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <GuardedStartLink
              href="/workout/new"
              session={guardSession}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "font-semibold uppercase tracking-wide",
              )}
            >
              Quick Log
            </GuardedStartLink>
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
            <GuardedStartLink
              href="/workout/new"
              session={guardSession}
              className={cn(
                buttonVariants({ size: "lg" }),
                "mt-6 w-full text-base font-semibold uppercase tracking-wide",
              )}
            >
              + Start Workout
            </GuardedStartLink>

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

        {/* Unfinished sits ABOVE History: these rows still need an action
            (resume or finish), while History is done. Deliberately quiet —
            no volt chip, muted throughout: the live session already owns the
            banner up top; anything here is a stale abandonment, not live
            state. Rows reopen the logger, never the read-only summary (which
            would present them as completed). */}
        {unfinished.length > 0 && (
          <>
            <h2 className="mt-10 mb-3 text-lg">Unfinished</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {unfinished.map((w) => (
                <li key={w.id}>
                  <Link
                    href={`/workout/${w.id}/edit`}
                    className="flex min-w-0 items-center gap-4 px-4 py-3.5 transition-colors active:bg-muted/60"
                  >
                    {/* Same calendar anchor as History for scan continuity,
                        but muted — these dates mark where a session stalled,
                        not an achievement. */}
                    <span className="flex w-9 shrink-0 flex-col items-center text-muted-foreground">
                      <span className="font-display text-xl leading-none tnum">
                        {w.startedAt.getDate()}
                      </span>
                      <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest">
                        {monthFormat.format(w.startedAt)}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{w.name ?? "Workout"}</span>
                      <span className="mt-0.5 block truncate text-sm text-muted-foreground tnum">
                        {`started · ${w.completedSetCount} set${w.completedSetCount === 1 ? "" : "s"} logged`}
                      </span>
                    </span>
                    {/* A quiet word instead of the chevron: "resume" says what
                        tapping does; a bare chevron would read like a detail
                        disclosure. */}
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Resume
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        <h2 className="mt-10 mb-3 text-lg">History</h2>

        {completed.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-12 text-center">
            <p className="font-medium">No workouts yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tap “Start Workout” to log your first session.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {completed.map((w) => (
              // gap-1 gives the Repeat link's expanded hit inset dead space
              // to land in — without it the inset overlaps the row link.
              <li key={w.id} className="flex items-center gap-1">
                <Link
                  // Completed only in this list, so every row goes to its
                  // summary; unfinished rows live in the section above.
                  href={`/workout/${w.id}`}
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
                    <span className="block truncate font-medium">{w.name ?? "Workout"}</span>
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
                {/* Repeat starts a NEW session seeded from this one — so it
                    goes through the same guard as the other start CTAs. */}
                <GuardedStartLink
                  href={`/workout/new?from=${w.id}`}
                  session={guardSession}
                  aria-label={`Repeat ${w.name ?? "Workout"}`}
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "icon-sm" }),
                    // Invisible inset lifts the 36px visual button toward the
                    // 44px HIG target without growing the row.
                    "relative mr-2 shrink-0 text-muted-foreground before:absolute before:-inset-1",
                  )}
                >
                  <RotateCcw aria-hidden="true" className="size-5" />
                </GuardedStartLink>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
