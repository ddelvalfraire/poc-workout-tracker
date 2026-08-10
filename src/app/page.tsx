import Link from "next/link";
import { Settings } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { requireUserId } from "@/lib/auth";
import { listWorkoutSummaries } from "@/db/workouts";
import { listWorkoutDrafts } from "@/db/workout-drafts";
import { getNextProgramDay } from "@/db/programs";
import { getWeightUnit, getHomeLayout } from "@/db/preferences";
import { resolveActiveSession } from "@/lib/active-session";
import { getCheckInStatus } from "@/lib/check-in";
import { getGoalsHomeSummary } from "@/lib/goals";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NavDrawer } from "@/components/nav/nav-drawer";
import { CheckInCard } from "./check-in-card";
import { renderHomeSections } from "./home-sections";
import { StatusHero } from "./status-hero";

export default async function HomePage() {
  const userId = await requireUserId(); // middleware also guards; this is defense-in-depth
  // The page fetches only what ITS layout decisions and client-component
  // props need; MomentumPanel self-fetches the rest. Every reader here is
  // request-memoized (React cache), so overlap with the panel (summaries,
  // unit, goals) still costs one query per request.
  const [summaries, unit, layout, nextDay, drafts, checkIn, goalsSummary] = await Promise.all([
    listWorkoutSummaries(userId),
    getWeightUnit(userId),
    // The section layout rides the SAME memoized preferences row as the unit
    // read above — resolving it adds zero queries to the default render.
    getHomeLayout(userId),
    getNextProgramDay(userId),
    listWorkoutDrafts(userId),
    // Null when the active program suggests no cadence — the card is gated on
    // `due`, so the common case renders nothing and costs one indexed read.
    getCheckInStatus(userId),
    // Null when the user has no active goals — the goals line costs one
    // indexed read then, and renders nothing. Still read here (not only in
    // the panel) for StatusHero's streak; the memo makes it one query.
    getGoalsHomeSummary(userId),
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
  // The trained-today fork stays a LOCAL-calendar-day question the server
  // can't answer — but it now selects a StatusHero STATE instead of removing
  // the hero (the "no hero card on my app" bug class is structurally gone).
  // Same evidence as the old gate: completion instants from the last 48h
  // (covers any timezone's "today" without a row cap), as epoch ms for
  // stable RSC serialization. Filtered on COMPLETION time, not start time:
  // a weeks-old Unfinished session finished today still counts.
  const GATE_WINDOW_MS = 48 * 60 * 60 * 1000;
  const recentCompleted = summaries.filter(
    (w) => w.completedAt !== null && now.getTime() - w.completedAt.getTime() <= GATE_WINDOW_MS,
  );
  // History is a record of finished sessions; unfinished rows get their own
  // quiet section (stale abandonments to resume or finish, not live state).
  const completed = summaries.filter((w) => w.completedAt !== null);
  const unfinished = summaries.filter((w) => w.completedAt === null);

  // The hero's memory, from summaries already in hand (zero new queries —
  // spike §5): the newest completion overall (trained-today + drifting
  // facts), and the newest completed volume under the up-next day's name
  // (the "last time" fact; per-set bests aren't in the summary read, so
  // volume is the honest version of it).
  const byCompletion = [...completed].sort(
    (a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
  );
  const newest = byCompletion[0];
  const lastCompleted = newest?.completedAt
    ? {
        id: newest.id,
        name: newest.name,
        completedAtMs: newest.completedAt.getTime(),
        volumeKg: newest.volumeKg,
      }
    : null;
  const lastTimeMatch = nextDay
    ? byCompletion.find(
        (w) => w.name?.trim().toLowerCase() === nextDay.dayName.trim().toLowerCase(),
      )
    : undefined;
  const lastTimeVolumeKg = lastTimeMatch && lastTimeMatch.volumeKg > 0 ? lastTimeMatch.volumeKg : null;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-safe pt-safe backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-5 pb-3 md:max-w-2xl">
          <div className="flex min-w-0 items-center gap-2">
            {/* The drawer trigger leads — home is the shell's root surface,
                and the drawer is now the app's navigation (spike §7). */}
            <NavDrawer />
            <h1 className="truncate text-2xl font-bold uppercase tracking-tight">Workout Tracker</h1>
          </div>
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

      {/* Wider on desktop (md:max-w-2xl) so the 4-unit bento row renders
          literally; the phone column stays max-w-md, byte-identical. */}
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe md:max-w-2xl">
        {/* STATUS zone — always rendered, digesting state into words (the
            Gentler Streak move). Every fork it owns is local-calendar, so it
            selects its state client-side from the facts below. */}
        <StatusHero
          session={
            activeSession && {
              key: activeSession.key,
              name: activeSession.name,
              setCount: activeSession.setCount,
              completedSetCount: activeSession.completedSetCount,
            }
          }
          nextDay={
            nextDay && {
              dayId: nextDay.dayId,
              programId: nextDay.programId,
              programName: nextDay.programName,
              dayName: nextDay.dayName,
              week: nextDay.week,
              mesocycleWeeks: nextDay.mesocycleWeeks,
              weekdays: nextDay.weekdays,
              blockComplete: nextDay.blockComplete,
            }
          }
          recentCompletedAtTimes={recentCompleted.map((w) => w.completedAt!.getTime())}
          lastCompleted={lastCompleted}
          lastTimeVolumeKg={lastTimeVolumeKg}
          streak={goalsSummary?.streak ?? null}
          guardSession={guardSession}
          unit={unit}
        />

        {/* Body check-in nudge — server-gated on `due` (never renders without
            an active-program cadence); the card handles dismiss-for-today.
            Position unchanged: due-ness doesn't care what the status says. */}
        {checkIn?.due && <CheckInCard daysSinceLast={checkIn.daysSinceLast} />}

        {/* OPTIONAL sections — presence and order are the user's layout
            document (settings → Customize home), resolved from preferences
            already in hand (zero extra queries). Sections render exactly as
            before; only the sequence became data-driven. Hidden sections'
            renderers never run, so a hidden Momentum panel costs no reads. */}
        {renderHomeSections(layout, {
          userId,
          nowMs: now.getTime(),
          unit,
          recentCompleted,
          completed,
          unfinished,
          guardSession: guardSession ?? null,
        })}

        {/* The quiet door to the layout editor — a whisper at the very
            bottom, after everything it edits. Discoverable when you go
            looking, invisible when you don't. */}
        <Link
          href="/settings/home"
          className="mx-auto mt-12 mb-4 block w-fit text-[10px] font-semibold uppercase tracking-widest text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground"
        >
          Edit home
        </Link>
      </main>
    </div>
  );
}
