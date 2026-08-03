import Link from "next/link";
import { ChevronRight, Settings } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { requireUserId } from "@/lib/auth";
import { listWorkoutSummaries } from "@/db/workouts";
import { listWorkoutDrafts } from "@/db/workout-drafts";
import { getNextProgramDay } from "@/db/programs";
import { getVolumeTotals } from "@/db/muscle-volume";
import { volumeWindows } from "@/lib/volume-window";
import { getWeightUnit } from "@/db/preferences";
import { resolveActiveSession } from "@/lib/active-session";
import { getCheckInStatus } from "@/lib/check-in";
import { getGoalsHomeSummary } from "@/lib/goals";
import { goalLabel } from "@/lib/goal-progress";
import { bucketDaySets } from "@/lib/drawer-status";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NavDrawer } from "@/components/nav/nav-drawer";
import { CheckInCard } from "./check-in-card";
import { HistoryList } from "./history-list";
import { MomentumPanel } from "./momentum-panel";
import { StatusHero } from "./status-hero";
import { TodayRecap } from "./today-recap";

// en-US matches formatWorkoutDate — one locale for all date display.
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short" });

/** Home keeps the freshest handful; the full log lives on /history (WHOOP
 *  tier discipline — history is tier-3 data on tier-1 real estate). */
const HOME_HISTORY_LIMIT = 5;

export default async function HomePage() {
  const userId = await requireUserId(); // middleware also guards; this is defense-in-depth
  const [summaries, unit, nextDay, drafts, checkIn, weekTotals, goalsSummary] = await Promise.all([
    listWorkoutSummaries(userId),
    getWeightUnit(userId),
    getNextProgramDay(userId),
    listWorkoutDrafts(userId),
    // Null when the active program suggests no cadence — the card is gated on
    // `due`, so the common case renders nothing and costs one indexed read.
    getCheckInStatus(userId),
    // Totals only (rolling window — tz-free, so the server can compute it):
    // getVolumeTotals skips muscle resolution, keeping the wger catalog off
    // the home page's critical path. /stats owns the full picture.
    getVolumeTotals(userId, volumeWindows("rolling", new Date())),
    // Null when the user has no active goals — the goals line costs one
    // indexed read then, and renders nothing.
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
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-5 pb-3">
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

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
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

        {/* MOMENTUM panel — one designed surface where the two teaser rows
            were. Skipped only on true day one: the fresh hero already
            invites, and two stacked invitations would compete. */}
        {(completed.length > 0 || goalsSummary !== null) && (
          <MomentumPanel
            weekSets={weekTotals.currentSets}
            weekSessions={weekTotals.currentSessions}
            daySets={bucketDaySets(summaries, now)}
            goal={
              goalsSummary?.topGoal
                ? {
                    activeCount: goalsSummary.activeCount,
                    label: goalLabel(goalsSummary.topGoal, unit),
                    streak: goalsSummary.streak,
                  }
                : null
            }
          />
        )}

        {/* TODAY recap — celebration cards for sessions completed on the
            user's local today (filter runs client-side; the 48h completion
            window covers any timezone's calendar day). */}
        <TodayRecap
          workouts={recentCompleted.map((w) => ({
            id: w.id,
            name: w.name,
            startedAtMs: w.startedAt.getTime(),
            completedAtMs: w.completedAt!.getTime(),
            volumeKg: w.volumeKg,
          }))}
          unit={unit}
        />

        {/* Unfinished sits ABOVE History: these rows still need an action
            (resume or finish), while History is done. Deliberately quiet —
            no volt chip, muted throughout: the live session already owns the
            hero up top; anything here is a stale abandonment, not live
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

        {/* HISTORY, demoted (WHOOP tier discipline): the last few compact
            rows; the full log lives on /history. No empty-state card here —
            with nothing completed, the fresh hero already owns the invite. */}
        {completed.length > 0 && (
          <>
            <div className="mt-10 mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-lg">History</h2>
              {completed.length > HOME_HISTORY_LIMIT && (
                <Link
                  href="/history"
                  className="flex shrink-0 items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  All history
                  <ChevronRight aria-hidden="true" className="size-4" />
                </Link>
              )}
            </div>
            <HistoryList
              workouts={completed.slice(0, HOME_HISTORY_LIMIT)}
              unit={unit}
              guardSession={guardSession}
            />
          </>
        )}
      </main>
    </div>
  );
}
