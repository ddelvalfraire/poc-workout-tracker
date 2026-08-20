import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import {
  getWorkoutDetail,
  getExerciseHistoryBefore,
  getPreviousCompletedWorkout,
} from "@/db/workouts";
import { getNextProgramDay } from "@/db/programs";
import { notesForWorkout } from "@/db/notes";
import { buildNoteView, type NoteView } from "@/components/notes/note-view";
import { NoteRow } from "@/components/notes/note-row";
import { DividerList } from "@/components/ui/divider-list";
import { getWeightUnit, getBodyweightKg } from "@/db/preferences";
import { goalsAchievedSince, listActiveGoals, type GoalRow } from "@/db/goals";
import { trophiesAchievedSince } from "@/db/trophies";
import { goalLabel, strengthPercent } from "@/lib/goal-progress";
import { trophyLabel } from "@/lib/trophies";
import { resolveFinishUpNext } from "@/lib/finish-up-next";
import {
  formatWorkoutDate,
  formatLoggedSet,
  formatE1RM,
  formatVolume,
  formatWorkoutDuration,
  workoutDurationMinutes,
} from "@/lib/format";
import { bestScoredSet } from "@/lib/one-rep-max";
import { effortLabel } from "@/lib/effort";
import {
  compareExercises,
  durationVsLastLabel,
  e1rmDeltaDisplay,
  e1rmDirectionSuffix,
  finishHeadline,
  prHighlights,
  volumeVsLastLabel,
} from "./summary-view";
import { AppHeader } from "@/components/app-header";
import { BackLink } from "@/components/back-link";
import { PrBadge } from "@/components/pr-badge";
import { ShareCardButton } from "@/components/share-card-button";
import { cn } from "@/lib/utils";
import { getActiveWorkoutShare } from "@/db/workout-shares";
import { WorkoutActions } from "./workout-actions";
import { WorkoutSharing } from "./workout-sharing";
import { FinishUpNextCard } from "./finish-up-next-card";
import { getTranslations } from 'next-intl/server';

export default async function WorkoutDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ finished?: string }>;
}) {
  const t = await getTranslations('WorkoutDetail');
  const userId = await requireUserId();
  const [{ id }, { finished }] = await Promise.all([params, searchParams]);
  // Presentation-only flag set by the logger's finish push: it dresses the
  // page as the completion moment, nothing more. Shared/bookmarked URLs
  // without it get the plain summary; refreshing with it is harmless.
  const justFinished = finished === "1";
  // Bodyweight rides along with the unit: it's the load basis for any
  // bodyweight-type exercise's top-set/PR scoring below (null = rep fallback).
  const [workout, unit, bodyweightKg] = await Promise.all([
    getWorkoutDetail(userId, id),
    getWeightUnit(userId),
    getBodyweightKg(userId),
  ]);
  if (!workout) notFound();
  // Guard at the source, not just at every link site: this read-only summary
  // presents a workout as DONE (duration, PR badges, top sets). An unfinished
  // session reaching it by URL — bookmark, back/forward cache, hand-edited
  // path — belongs in the logger instead.
  if (workout.completedAt === null) redirect(`/workout/${id}/edit`);

  const exerciseIds = [
    ...new Set(workout.exercises.map((e) => e.wgerExerciseId)),
  ];
  // Up-next only matters at the finish moment, and only for a program
  // session — a quick log has no rotation to advance. Fetched alongside the
  // PR history read (independent queries).
  const [
    history,
    nextDay,
    achievedGoals,
    activeGoals,
    sessionTrophies,
    activeShare,
    lastSameName,
    sessionNotes,
  ] =
    await Promise.all([
      getExerciseHistoryBefore(userId, exerciseIds, workout.startedAt),
      justFinished && workout.programDayId !== null
        ? getNextProgramDay(userId)
        : null,
      // "Achieved by THIS workout" = achievedAt inside the session's window
      // (start → now): the post-finish seam stamps achievedAt moments before
      // this page renders, so the window is the honest, race-free link between
      // session and achievement — no threading state through the redirect.
      justFinished ? goalsAchievedSince(userId, workout.startedAt) : [],
      justFinished ? listActiveGoals(userId) : [],
      justFinished ? trophiesAchievedSince(userId, workout.startedAt) : [],
      // The live share link, if one exists — seeds the Share control so the
      // copy row survives refreshes (mint state isn't client-only).
      getActiveWorkoutShare(userId, id),
      // The "vs last {name}" baseline — the ONE extra read authorized for
      // this page (Arc B; documented on the db helper). Unnamed sessions
      // have no meaningful "last": skipped, tiles render without deltas.
      workout.name !== null
        ? getPreviousCompletedWorkout(userId, workout.name, workout.startedAt)
        : null,
      // Every note anchored anywhere in this session (workout, exercises,
      // sets — plus outdated fallbacks), for the consolidated Notes section.
      notesForWorkout(userId, id),
    ]);
  // Same session-window honesty as the goals block, PLUS the attribution
  // mark: only trophies whose stored context names THIS workout celebrate —
  // an import that stamped mid-session stays quiet by construction.
  const earnedTrophies = sessionTrophies.filter(
    (t) => t.context.workoutId === workout.id,
  );
  const upNext = resolveFinishUpNext(workout.programDayId, nextDay);

  // The per-exercise session-vs-history comparisons, kept WHOLE (not reduced
  // to booleans) so the celebration zone can name its wins — the composite-
  // identity, best-across-cards, like-beats-like rules all live in
  // summary-view.ts now, unchanged and unit-tested.
  const comparisons = compareExercises(workout.exercises, history, bodyweightKg);
  const comparisonByKey = new Map(comparisons.map((c) => [c.key, c]));
  const prBadgeRowIds = new Set(
    comparisons.filter((c) => c.isPr).map((c) => c.firstCardId),
  );
  const highlights = prHighlights(comparisons);
  const headline = finishHeadline({
    prNames: highlights.map((h) => h.name),
    blockClosed: upNext.kind === "block-complete",
    programWeek: workout.programWeek,
  });


  // Strength goals TOUCHED by this workout (composite identity), minus the
  // just-achieved ones (they get the celebration block, not a percent line):
  // this session's best e1RM vs the target — progress the lifter just bought.
  const achievedGoalIds = new Set(achievedGoals.map((g) => g.id));
  const touchedStrengthGoals = activeGoals.flatMap(
    (goal): { goal: GoalRow; sessionE1rmKg: number; targetE1rmKg: number; percent: number }[] => {
      if (goal.kind !== "strength" || !("e1rmKg" in goal.target)) return [];
      if (achievedGoalIds.has(goal.id)) return [];
      // The session best is already scored (composite identity, current
      // logging type) in the comparisons above — one source of truth.
      const best = comparisonByKey.get(`${goal.source}:${goal.wgerExerciseId}`)?.current;
      if (!best || best.kind !== "e1rm") return [];
      return [
        {
          goal,
          sessionE1rmKg: best.e1rm,
          targetE1rmKg: goal.target.e1rmKg,
          percent: strengthPercent(best.e1rm, goal.target.e1rmKg),
        },
      ];
    },
  );

  const totalSets = workout.exercises.reduce((n, e) => n + e.sets.length, 0);
  const volumeKg = workout.exercises.reduce(
    (sum, e) => sum + e.sets.reduce((s, set) => s + (set.reps ?? 0) * (set.weight ?? 0), 0),
    0,
  );
  const duration = formatWorkoutDuration(workout.startedAt, workout.completedAt);

  // The consolidated Notes rows: notesForWorkout reads oldest-first, and the
  // stable anchor partition keeps every anchor's notes together — grouped by
  // anchor, with each row's breadcrumb naming the anchor.
  const now = new Date();
  const noteViews: NoteView[] = groupSessionNotesByAnchor(sessionNotes).map((note) =>
    buildNoteView(note, unit, now),
  );

  // "vs last {name}" deltas against the most recent completed same-name
  // session (see lastSameName above). Null when flat or uncomputable — the
  // tiles simply stay single-line, never "±0".
  const volumeDelta = lastSameName
    ? volumeVsLastLabel(volumeKg, lastSameName.volumeKg, unit)
    : null;
  const durationDelta = lastSameName
    ? durationVsLastLabel(
        workoutDurationMinutes(workout.startedAt, workout.completedAt),
        workoutDurationMinutes(lastSameName.startedAt, lastSameName.completedAt),
      )
    : null;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={workout.name ?? t('titleFallback')}
        leading={
          // Fallback /history, not / — the canonical parent of a workout
          // record (spike §3c); warm arrivals pop to their true origin.
          <BackLink fallback="/history" />
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {/* The completion moment: poster type over the stat row it crowns.
            The headline numbers stay in the dl below — one source, the
            heading just reframes them as the payoff. Volt rides the eyebrow
            and the PR chip (markers, not CTAs — the one-volt button rule
            is about actions and stays with WorkoutActions). */}
        {justFinished && (
          <section
            aria-label={t('complete.groupLabel')}
            className="mt-6 motion-safe:animate-rise-in"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              {t('complete.badge')}
            </p>
            <div className="mt-1 flex items-start justify-between gap-3">
              {/* The most specific true headline (summary-view copy table):
                  "Two PRs." / "Bench PR." / "Week 7 closed." — never a
                  generic stamp when something better happened. */}
              <h2 className="min-w-0 font-display text-4xl uppercase leading-none tracking-wide">
                {t(`headline.${headline.key}`, headline.values)}
              </h2>
              {/* The session's share card, right in the celebration moment —
                  the link-based WorkoutSharing block below stays put. */}
              <ShareCardButton
                cardUrl={`/api/cards/workout/${workout.id}`}
                shareTitle={workout.name ?? t('titleFallback')}
                className="-my-1 shrink-0"
              />
            </div>
            {/* Named PR deltas — the numbers the old badge threw away. Volt
                is earned: these are the session's achievements. Staggered a
                beat behind the headline (motion clarifies reading order). */}
            {highlights.length > 0 && (
              <ul
                className="mt-3 space-y-1 motion-safe:animate-rise-in [animation-delay:90ms] [animation-fill-mode:backwards]"
              >
                {highlights.map((h) => (
                  <li
                    key={h.name}
                    className="flex items-baseline gap-2 font-display text-xl uppercase leading-none tracking-wide text-primary tnum"
                  >
                    <span className="min-w-0 truncate">{h.name}</span>
                    <span className="shrink-0">
                      {h.kind === "e1rm"
                        ? t.rich("complete.prE1rm", {
                            value: formatE1RM(h.e1rmKg, unit),
                            delta: e1rmDeltaDisplay(h.deltaKg, unit),
                            // The tilde is decoration, not a word: kept out
                            // of the accessible name, kept inside the one
                            // message so its position stays translatable.
                            approx: (chunks) => <span aria-hidden="true">{chunks}</span>,
                          })
                        : t("complete.prReps", { reps: h.reps, delta: h.deltaReps })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* One readable meta line (chips → words): date · week. The week is
            program context, not an action — volt small-caps text marks it the
            same way the "Session logged" eyebrow does, no pill shell. */}
        <p className="mt-4 text-sm text-muted-foreground">
          {workout.programWeek === null
            ? formatWorkoutDate(workout.startedAt)
            : t.rich("meta.summary", {
                date: formatWorkoutDate(workout.startedAt),
                week: workout.programWeek,
                separator: (chunks) => <span aria-hidden="true">{chunks}</span>,
                weekLabel: (chunks) => (
                  <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                    {chunks}
                  </span>
                ),
              })}
        </p>

        {/* Third beat of the finish stagger (headline → PR lines → stats);
            plain render on a revisit — motion marks the moment, not the page. */}
        <dl
          className={cn(
            // De-carded: the stat band sits between hairlines, tiles keep
            // their internal hairline dividers — no shell, no fill.
            "mt-3 grid grid-cols-3 border-y border-border",
            justFinished &&
              "motion-safe:animate-rise-in [animation-delay:180ms] [animation-fill-mode:backwards]",
          )}
        >
          <Stat
            label={t("stats.duration")}
            value={duration ?? t("stats.empty")}
            sub={durationDelta}
          />
          <Stat
            label={t("stats.volume")}
            value={volumeKg > 0 ? formatVolume(volumeKg, unit) : t("stats.empty")}
            sub={volumeDelta}
          />
          <Stat label={t("stats.sets", { count: totalSets })} value={String(totalSets)} />
        </dl>
        {/* One caption names the comparison for both tile deltas — tiles are
            too narrow to repeat "vs last {name}" inside each. */}
        {(volumeDelta !== null || durationDelta !== null) && (
          <p className="mt-1.5 px-1 text-xs text-muted-foreground">
            {t("comparisonCaption", { name: workout.name ?? "" })}
          </p>
        )}

        {/* What comes after the finish: the next program day, or the block-
            complete banner when this session closed the mesocycle. Quick
            logs (upNext 'none') get just the celebration above. */}
        {/* Goal moments, honest ones only: a volt celebration for goals whose
            achievedAt landed inside THIS session's window, and quiet percent
            lines for strength targets this workout moved but didn't finish. */}
        {justFinished && achievedGoals.length > 0 && (
          <section
            aria-label={t('goals.groupLabel')}
            // De-carded: the volt hairline under the section is the same
            // quiet "achievement" state marker the logger's done sections
            // wear — celebration lives in the volt type, not a shell.
            className="mt-6 border-b border-b-primary/30 pb-5 motion-safe:animate-rise-in"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              {t("goals.title", { count: achievedGoals.length })}
            </p>
            <ul className="mt-2 space-y-1">
              {achievedGoals.map((goal) => (
                <li
                  key={goal.id}
                  className="font-display text-3xl uppercase leading-none tracking-wide"
                >
                  {goalLabel(goal, unit)}
                </li>
              ))}
            </ul>
            <Link
              href="/goals"
              className="mt-3 inline-block text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('goals.action')}
            </Link>
          </section>
        )}
        {/* Trophy moments ride beside the goal ones — same volt treatment,
            same honesty rule (see earnedTrophies above). */}
        {justFinished && earnedTrophies.length > 0 && (
          <section
            aria-label={t('trophies.groupLabel')}
            // Same de-carded volt-hairline treatment as the goals block.
            className="mt-6 border-b border-b-primary/30 pb-5 motion-safe:animate-rise-in"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              {t("trophies.title", { count: earnedTrophies.length })}
            </p>
            <ul className="mt-2 space-y-1">
              {earnedTrophies.map((trophy) => (
                <li
                  key={trophy.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="min-w-0 font-display text-3xl uppercase leading-none tracking-wide">
                    {trophyLabel(trophy.kind)}
                  </span>
                  {/* Shares the rendered card PNG via the OS sheet. */}
                  <ShareCardButton
                    cardUrl={`/api/cards/trophy/${trophy.kind}`}
                    shareTitle={trophyLabel(trophy.kind)}
                    className="-my-1 shrink-0"
                  />
                </li>
              ))}
            </ul>
            <Link
              href="/trophies"
              className="mt-3 inline-block text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('trophies.action')}
            </Link>
          </section>
        )}
        {justFinished && touchedStrengthGoals.length > 0 && (
          <section
            aria-label={t('goalProgress.groupLabel')}
            // Progress-not-achievement stays on the muted hairline (one-volt
            // rule: volt marks the reached goals above, not the partials).
            className="mt-6 border-b border-b-border/60 pb-4"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t('goalProgress.title')}
            </p>
            <ul className="mt-2 space-y-1.5">
              {touchedStrengthGoals.map(({ goal, sessionE1rmKg, targetE1rmKg, percent }) => (
                <li
                  key={goal.id}
                  className="flex items-baseline justify-between gap-3 text-sm tnum"
                >
                  <span className="min-w-0 truncate">
                    {t("goalProgress.summary", {
                      exercise: goal.exerciseName ?? "",
                      current: formatE1RM(sessionE1rmKg, unit),
                      target: formatE1RM(targetE1rmKg, unit),
                    })}
                  </span>
                  <span className="shrink-0 font-semibold text-primary">
                    {t("goalProgress.percent", { percent })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {justFinished && upNext.kind !== "none" && (
          <FinishUpNextCard state={upNext} />
        )}

        {/* Hairline sections breathe a touch more than the old card stack —
            the divider is doing the separating work the shells used to. */}
        <div className="mt-6 space-y-4">
          {workout.exercises.map((exercise) => {
            // Scored under the exercise's logging type: highest e1rm over the
            // EFFECTIVE load, or the most-reps fallback when no set is
            // load-scorable (bodyweight work without a stored bodyweight, or
            // sets logged with no weight — "top set" must still resolve).
            // A skipped exercise earns no top-set/e1RM emphasis — nothing
            // was attempted, so there is nothing to celebrate.
            const current = exercise.skipped
              ? null
              : bestScoredSet(exercise.sets, exercise.loggingType, bodyweightKg);
            // The top set gets marked — but only when there's a comparison to
            // make; a lone set being "best" is noise.
            const bestIndex =
              current && exercise.sets.length > 1 ? current.index : -1;
            const isPR = prBadgeRowIds.has(exercise.id);

            return (
              <section
                key={exercise.id}
                // De-carded (logger vocabulary): sections sit on hairline
                // dividers, no shell. PrBadge alone carries the PR marker —
                // a volt hairline on top of it would stack volt per PR'd
                // exercise on every revisit (one-volt rule).
                className="border-b border-b-border/60 pb-4"
              >
                <div className="flex items-center justify-between gap-2">
                  {/* Display type on the movement name: the card is a record
                      of work done under a bar — let it read like one. */}
                  <h2
                    className={cn(
                      "min-w-0 truncate font-display text-lg uppercase leading-tight tracking-wide",
                      exercise.skipped && "text-muted-foreground",
                    )}
                  >
                    {exercise.name}
                  </h2>
                  {exercise.skipped ? (
                    // Chip → word: skipped is a label, not a control.
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {t('exercise.skippedBadge')}
                    </span>
                  ) : (
                    isPR && <PrBadge />
                  )}
                </div>
                {/* Set rows echo the logger's DONE-row treatment (log →
                    review continuity): volt check + quiet text line — pure
                    display here, so even simpler than the logger's. The top
                    set reads heavier than the rest; a skipped exercise keeps
                    the muted numbered disc (nothing was done to check off). */}
                <div className="mt-3 space-y-2">
                  {exercise.sets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('exercise.empty')}</p>
                  ) : (
                    exercise.sets.map((set, setIndex) => (
                      <div key={set.id} className="flex items-center gap-3">
                        <span
                          aria-label={t("exercise.setAriaLabel", { number: set.setNumber })}
                          className={cn(
                            // Number stays visible on every disc — a wall of
                            // identical checks loses the set index sighted
                            // lifters audit rows by (review parity finding).
                            "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold tnum",
                            exercise.skipped
                              ? "bg-muted text-muted-foreground"
                              : "bg-primary text-primary-foreground",
                          )}
                        >
                          {set.setNumber}
                        </span>
                        <span
                          className={cn(
                            "tnum text-base",
                            setIndex === bestIndex
                              ? "font-semibold"
                              : "font-medium text-muted-foreground",
                          )}
                        >
                          {formatLoggedSet(set, unit, exercise.loggingType)}
                        </span>
                        {/* Logged effort as words (never a chip here — pure
                            display): muted, after the set text, absent when
                            nothing was logged. */}
                        {(() => {
                          const effort = effortLabel(set.rir, set.rpe);
                          if (!effort) return null;
                          return (
                            <span className="text-xs text-muted-foreground tnum">{effort}</span>
                          );
                        })()}
                        {setIndex === bestIndex && (
                          // Chip → word (logger grammar): a quiet caps label,
                          // no pill shell.
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                            {t('exercise.topSetBadge')}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {current && (
                  <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {current.kind === "e1rm" ? t("exercise.e1rmLabel") : t("exercise.topSetLabel")}
                    </span>
                    {current.kind === "e1rm" ? (
                      <span className="font-display text-3xl leading-none tnum">
                        <span aria-hidden="true" className="text-muted-foreground">
                          {t('exercise.approx')}
                        </span>
                        {formatE1RM(current.e1rm, unit)}
                        {/* Direction against the exercise's prior best — no
                            number without direction. Absent priors (first
                            time on the lift) stay quiet. */}
                        {(() => {
                          const prior = comparisonByKey.get(
                            `${exercise.source}:${exercise.wgerExerciseId}`,
                          )?.prior;
                          const suffix =
                            prior?.kind === "e1rm"
                              ? e1rmDirectionSuffix(current.e1rm - prior.e1rm, unit)
                              : null;
                          return suffix !== null ? (
                            <span className="ml-2 text-base text-muted-foreground">
                              {suffix}
                            </span>
                          ) : null;
                        })()}
                      </span>
                    ) : (
                      // Rep fallback: no load to estimate from, but the best
                      // effort still deserves its readout — not a blank card.
                      <span className="font-display text-3xl leading-none tnum">
                        {t("exercise.repsValue", { reps: current.reps })}
                      </span>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {/* The consolidated Notes section (notes v2 slice 3): EVERY note
            anchored in this session — workout, exercise, set, coach rows,
            and outdated fallbacks — with anchor breadcrumbs, replacing the
            scattered per-block renders. Reading order within each anchor. */}
        {noteViews.length > 0 && (
          <section aria-label={t('notes.groupLabel')} className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t('notes.title')}
            </h2>
            <DividerList className="mt-2">
              {noteViews.map((note) => (
                <NoteRow key={note.id} note={note} />
              ))}
            </DividerList>
          </section>
        )}

        {/* Share control above the action stack: this page only renders
            COMPLETED workouts (live sessions redirected to the logger above),
            so the completed-only rule holds by construction here too. */}
        <WorkoutSharing workoutId={workout.id} shareToken={activeShare?.token ?? null} />

        <WorkoutActions id={workout.id} />
      </main>
    </div>
  );
}

/** Stable anchor partition for the Notes section: buckets rows by their
 *  concrete anchor (set, exercise, or the workout itself), first-seen order,
 *  preserving reading order inside each bucket — "grouped by anchor" without
 *  losing notesForWorkout's chronology. */
function groupSessionNotesByAnchor<
  T extends { setId: string | null; workoutExerciseId: string | null },
>(rows: T[]): T[] {
  const order: string[] = [];
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.setId ?? row.workoutExerciseId ?? "workout";
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(row);
      continue;
    }
    buckets.set(key, [row]);
    order.push(key);
  }
  return order.flatMap((key) => buckets.get(key) ?? []);
}

/** One tile of the session stat row: big tabular value over a small label,
 *  plus an optional signed "vs last" delta sub-line (muted — context, not
 *  celebration; volt stays with the PR lines). DOM keeps the valid dt→dd
 *  order; flex-col-reverse renders value on top. */
function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    // Valid dl grouping keeps dt before its dds; CSS order puts the value on
    // top (as flex-col-reverse did) with the delta reading last.
    <div className="flex flex-col border-l border-border px-4 py-3 first:border-l-0">
      <dt className="order-2 mt-0.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="order-1 tnum text-3xl font-semibold tracking-tight">{value}</dd>
      {sub != null && (
        <dd className="order-3 mt-0.5 truncate text-xs text-muted-foreground tnum">{sub}</dd>
      )}
    </div>
  );
}
