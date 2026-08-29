import Link from "next/link";
import { Settings } from "lucide-react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import { getConsentState } from "@/db/consent";
import { ConsentIdentity } from "@/components/consent-identity";
import { listWorkoutSummaries } from "@/db/workouts";
import { listWorkoutDrafts } from "@/db/workout-drafts";
import { getNextProgramDay } from "@/db/programs";
import { getWeightUnit } from "@/db/preferences";
import { getSeededHomeLayout } from "@/db/home-signal";
import { resolveActiveSession } from "@/lib/active-session";
import { getCheckInStatus } from "@/lib/check-in";
import { getGoalsHomeSummary } from "@/lib/goals";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NavDrawer } from "@/components/nav/nav-drawer";
import { CheckInCard } from "@/components/home/check-in-card";
import { renderHomeSections } from "./_home/home-sections";
import { StatusHero } from "@/components/home/status-hero";
import { getTranslations } from 'next-intl/server';

export default async function HomePage() {
  const t = await getTranslations('Home');
  // The product name is one string, not three: a brand cannot diverge by
  // surface, and three copies are three chances to translate it apart.
  const tCommon = await getTranslations('Common');
  const userId = await requireUserId(); // middleware also guards; this is defense-in-depth
  // Consent gate (4b): ALL required purposes must be currently granted —
  // gating on tos alone would strand a user whose health consent was
  // withdrawn (in, but unable to re-consent). One indexed read per home
  // load; 4c replaces this with a session-claim check in the middleware so
  // every route is covered without the read.
  const consent = await getConsentState(userId);
  const requiredGranted =
    consent.tos?.granted && consent.health_collect?.granted && consent.health_share?.granted;
  if (!requiredGranted) redirect("/welcome");
  // The page fetches only what ITS layout decisions and client-component
  // props need; MomentumPanel self-fetches the rest. Every reader here is
  // request-memoized (React cache), so overlap with the panel (summaries,
  // unit, goals) still costs one query per request.
  // One instant for the whole request: the layout seed's eight-week window
  // and the trained-today gate below must not straddle a tick.
  const now = new Date();
  const [summaries, unit, layout, nextDay, drafts, checkIn, goalsSummary] = await Promise.all([
    listWorkoutSummaries(userId),
    getWeightUnit(userId),
    // Rides the SAME memoized preferences row as the unit read above, so a
    // saved layout still resolves with zero extra queries. Only a home nobody
    // has customized goes on to ask the derived read what to show.
    getSeededHomeLayout(userId, now.getTime()),
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
  // Completed sessions feed the hero's memory below; unfinished rows get
  // their own quiet section (stale abandonments, not live state). The full
  // log lives at /history — home no longer renders it.
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
      {/* Identity reconciler mounts on the surfaces that already read the
          consent projection (home + settings) rather than the root layout —
          an auth() read there would de-static the public legal pages. Home
          is every session's entry, so devices converge here. */}
      <ConsentIdentity
        userId={userId}
        granted={Boolean(consent.analytics_identity?.granted)}
      />
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-safe pt-safe backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-5 pb-3 md:max-w-3xl xl:max-w-6xl">
          <div className="flex min-w-0 items-center gap-2">
            {/* The drawer trigger leads — home is the shell's root surface,
                and the drawer is now the app's navigation (spike §7). */}
            <NavDrawer />
            <h1 className="truncate text-2xl font-bold uppercase tracking-tight">{tCommon('appName')}</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* Preferences live on /settings now — the header keeps only
                identity and the door to them. */}
            <Link
              href="/settings"
              aria-label={t('settingsLink')}
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon-sm" }),
                "relative text-muted-foreground before:absolute before:-inset-1",
              )}
            >
              <Settings aria-hidden="true" className="size-5" />
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Three container tiers matching the bento's column counts: the phone
          column is unchanged, md gets the 4-column grid, xl the 6-column one.
          Widening is home's single exception to the one-column reading rule
          (DESIGN.md); every other reading surface stays the phone column. */}
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe md:max-w-3xl xl:max-w-6xl">
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
        {await renderHomeSections(layout, {
          userId,
          nowMs: now.getTime(),
          unit,
          recentCompleted,
          unfinished,
        })}

        {/* The quiet door to the layout editor — a whisper at the very
            bottom, after everything it edits. Discoverable when you go
            looking, invisible when you don't. */}
        <Link
          href="/settings/home"
          className="mx-auto mt-12 mb-4 block w-fit text-[10px] font-semibold uppercase tracking-widest text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground"
        >
          {t('editHomeLink')}
        </Link>
      </main>
    </div>
  );
}
