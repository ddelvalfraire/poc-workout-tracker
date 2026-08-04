import Link from 'next/link'
import { ChevronRight, Dumbbell, Flame, Scale, Trophy } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { getWeightUnit } from '@/db/preferences'
import { listArchivedGoals } from '@/db/goals'
import { listBodyweightLogs } from '@/db/bodyweight'
import { goalLabel, paceVsDeadline, sortGoalsByTension } from '@/lib/goal-progress'
import {
  evaluateGoalProgress,
  getStreakEvidence,
  type GoalWithProgress,
  type StreakEvidence,
} from '@/lib/goals'
import { formatE1RM, formatWorkoutDate } from '@/lib/format'
import { kgToDisplay, type WeightUnit } from '@/lib/units'
import { TrendChart, type TrendPoint } from '@/components/charts/trend-chart'
import { AppHeader } from '@/components/app-header'
import { NavDrawer } from '@/components/nav/nav-drawer'
import { cn } from '@/lib/utils'
import { GoalCreate } from './goal-create'
import { GoalCardActions } from './goal-card-actions'
import { ConsistencyProgress } from './consistency-progress'

// Volt threshold: a strength percent this close to done earns the accent.
const NEAR_TARGET_PERCENT = 90
// The bodyweight mini-chart's window: enough logs for a real shape, small
// enough that the card stays a card.
const BODYWEIGHT_CHART_POINTS = 30

/**
 * /goals — the user's own targets ("goal tracking we can create our own
 * version of goals"): strength (est. 1RM per exercise), bodyweight, and
 * consistency streaks with per-goal grace. Every number on this page is
 * derived from stats the app already computes; the page never invents
 * progress. Cards lead with ONE big number and sort by tension (nearest
 * target first, achieved on top for the DONE moment). Consistency readouts
 * render client-side (weeks are the user's calendar); everything else is
 * server-rendered.
 */
export default async function GoalsPage() {
  const userId = await requireUserId()
  const [evaluated, archived, unit] = await Promise.all([
    evaluateGoalProgress(userId),
    listArchivedGoals(userId),
    getWeightUnit(userId),
  ])
  // One evidence read serves every consistency card (each applies its own
  // grace); skipped entirely when no consistency goal exists.
  const evidence = evaluated.some((e) => e.goal.kind === 'consistency')
    ? await getStreakEvidence(userId)
    : null
  // The bodyweight card's mini trend: the goals evaluation only carries the
  // denormalized current weight, so the card's chart needs one extra cheap
  // read (indexed, capped) — paid only when a bodyweight goal exists.
  const bodyweightLogs = evaluated.some((e) => e.goal.kind === 'bodyweight')
    ? await listBodyweightLogs(userId, BODYWEIGHT_CHART_POINTS)
    : []
  const bodyweightPoints: TrendPoint[] = [...bodyweightLogs].reverse().map((log) => ({
    label: formatWorkoutDate(log.weighedAt),
    value: kgToDisplay(log.weightKg, unit),
  }))

  const sorted = sortGoalsByTension(evaluated)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Goals"
        leading={<NavDrawer />}
      />

      <main className="mx-auto w-full max-w-md flex-1 space-y-6 px-5 pb-safe pt-6">
        {evaluated.length === 0 ? (
          <>
            {/* Empty state keeps the big invitation — the one action that matters. */}
            <GoalCreate unit={unit} />
            <div className="rounded-2xl border border-border bg-card px-5 py-12 text-center">
              <p className="font-medium">No goals yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Set a strength target, a bodyweight target, or a training streak.
              </p>
            </div>
          </>
        ) : (
          <section aria-label="Active goals">
            <div className="flex items-center justify-between gap-2">
              <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Active
              </h2>
              {/* Demoted to the header row — the goals are the page. */}
              <GoalCreate unit={unit} compact />
            </div>
            <div className="mt-2 space-y-3">
              {sorted.map((entry) => (
                <GoalCard
                  key={entry.goal.id}
                  entry={entry}
                  unit={unit}
                  evidence={evidence}
                  bodyweightPoints={bodyweightPoints}
                />
              ))}
            </div>
          </section>
        )}

        {/* The trophy case's one entry point — goals are the achievement
            family, so the link lives here (home already carries its stack). */}
        <Link
          href="/trophies"
          className="flex items-center gap-2.5 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
        >
          <Trophy aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">Trophies</span>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </Link>

        {archived.length > 0 && (
          <section aria-label="Archived goals">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Archived
            </h2>
            <ul className="mt-2 space-y-3">
              {archived.map((goal) => (
                <li
                  key={goal.id}
                  className="rounded-2xl border border-border bg-card p-4 text-muted-foreground"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {goalLabel(goal, unit)}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {goal.achievedAt !== null && (
                        <span className="text-xs uppercase tracking-widest">Achieved</span>
                      )}
                      <GoalCardActions id={goal.id} label={goalLabel(goal, unit)} archived />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}

const KIND_ICONS = { strength: Dumbbell, bodyweight: Scale, consistency: Flame } as const

function GoalCard({
  entry,
  unit,
  evidence,
  bodyweightPoints,
}: {
  entry: GoalWithProgress
  unit: WeightUnit
  evidence: StreakEvidence | null
  bodyweightPoints: TrendPoint[]
}) {
  const { goal, progress } = entry
  const Icon = KIND_ICONS[goal.kind]
  const label = goalLabel(goal, unit)
  const isAchieved = goal.achievedAt !== null

  return (
    <article
      className={cn(
        'rounded-2xl border bg-card p-4',
        isAchieved
          ? 'border-primary/50 bg-primary/10 motion-safe:animate-rise-in'
          : 'border-border',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="min-w-0 truncate font-display text-lg uppercase leading-tight tracking-wide">
            {label}
          </h2>
        </div>
        <GoalCardActions id={goal.id} label={label} archived={false} />
      </div>

      <div className="mt-3">
        {goal.achievedAt !== null ? (
          <div>
            {/* The DONE moment. No share button on purpose: goals have no
                share-card type in lib/cards, borrowing a trophy/PR card would
                misstate the fact, and new card routes are out of this arc's
                scope — the moment ships without the verb until a goal card
                exists. */}
            <p className="font-display text-4xl uppercase leading-none text-primary">Done.</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Achieved {formatWorkoutDate(goal.achievedAt)}
            </p>
          </div>
        ) : (
          <>
            {progress.kind === 'strength' && (
              <div>
                {/* The one big number: percent to target. */}
                <p>
                  <span
                    className={cn(
                      'font-display text-4xl leading-none tnum',
                      progress.percent >= NEAR_TARGET_PERCENT && 'text-primary',
                    )}
                  >
                    {progress.percent}%
                  </span>
                </p>
                <p className="mt-1.5 text-sm text-muted-foreground tnum">
                  {progress.bestE1rmKg !== null
                    ? `Best ${formatE1RM(progress.bestE1rmKg, unit)}`
                    : 'No est. 1RM yet'}
                </p>
                <div
                  role="progressbar"
                  aria-valuenow={progress.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Progress to target"
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                {/* Pace only when the trend honestly supports it — otherwise
                    silence. Promoted to a full sentence against the deadline. */}
                {progress.projectedAt !== null && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    On pace for {formatWorkoutDate(progress.projectedAt)}
                    {paceSuffix(progress.projectedAt, goal.deadline)}
                  </p>
                )}
              </div>
            )}

            {progress.kind === 'bodyweight' && (
              <div>
                {progress.currentKg !== null && progress.remainingKg !== null ? (
                  <>
                    <p className="flex items-baseline gap-1.5">
                      <span className="font-display text-4xl leading-none tnum">
                        {kgToDisplay(progress.remainingKg, unit)}
                      </span>
                      <span className="text-xl text-muted-foreground">{unit} to go</span>
                    </p>
                    <p className="mt-1.5 text-sm text-muted-foreground tnum">
                      Now {kgToDisplay(progress.currentKg, unit)} {unit}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Log your bodyweight to track this goal.
                  </p>
                )}
                {bodyweightPoints.length >= 2 && 'weightKg' in goal.target && (
                  <div role="group" aria-label="Bodyweight trend" className="mt-3">
                    <TrendChart
                      points={bodyweightPoints}
                      unit={unit}
                      valueLabel="Bodyweight"
                      ariaLabel={`Bodyweight trend over ${bodyweightPoints.length} entries against the ${kgToDisplay(goal.target.weightKg, unit)} ${unit} target`}
                      targetValue={kgToDisplay(goal.target.weightKg, unit)}
                      targetLabel="Target"
                      className="h-24"
                    />
                  </div>
                )}
              </div>
            )}

            {progress.kind === 'consistency' && evidence !== null && (
              <ConsistencyProgress
                completedAtTimes={evidence.completedAtTimes}
                scheduledWeekdays={evidence.scheduledWeekdays}
                allowedMissesPerWeek={progress.allowedMissesPerWeek}
                targetWeeks={progress.targetWeeks}
              />
            )}
          </>
        )}
      </div>

      {!isAchieved &&
        (goal.deadline !== null || progress.kind === 'consistency') && (
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            {goal.deadline !== null && <span>By {formatDeadline(goal.deadline)}</span>}
            {progress.kind === 'consistency' && (
              <span>
                {progress.allowedMissesPerWeek === 0
                  ? 'Strict'
                  : `${progress.allowedMissesPerWeek} miss${progress.allowedMissesPerWeek === 1 ? '' : 'es'}/week grace`}
              </span>
            )}
          </div>
        )}
    </article>
  )
}

/** " — 3 weeks early" (or late), empty when no deadline / within a week. */
function paceSuffix(projectedAt: Date, deadline: string | null): string {
  const verdict = paceVsDeadline(projectedAt, deadline)
  return verdict === null ? '' : ` — ${verdict}`
}

/** YYYY-MM-DD → the app's one date wording, parsed as LOCAL midnight (a
 *  deadline is a calendar date, not an instant — no UTC shift). */
function formatDeadline(deadline: string): string {
  const [y, m, d] = deadline.split('-').map(Number)
  return formatWorkoutDate(new Date(y, m - 1, d))
}
