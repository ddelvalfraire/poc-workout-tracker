import Link from 'next/link'
import { ChevronLeft, Dumbbell, Flame, Scale } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { getWeightUnit } from '@/db/preferences'
import { listArchivedGoals } from '@/db/goals'
import { goalLabel } from '@/lib/goal-progress'
import {
  evaluateGoalProgress,
  getStreakEvidence,
  type GoalWithProgress,
  type StreakEvidence,
} from '@/lib/goals'
import { formatE1RM, formatWorkoutDate } from '@/lib/format'
import { kgToDisplay, type WeightUnit } from '@/lib/units'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { GoalCreate } from './goal-create'
import { GoalCardActions } from './goal-card-actions'
import { ConsistencyProgress } from './consistency-progress'

/**
 * /goals — the user's own targets ("goal tracking we can create our own
 * version of goals"): strength (est. 1RM per exercise), bodyweight, and
 * consistency streaks with per-goal grace. Every number on this page is
 * derived from stats the app already computes; the page never invents
 * progress. Consistency readouts render client-side (weeks are the user's
 * calendar); everything else is server-rendered.
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

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Goals"
        leading={
          <Link
            href="/"
            aria-label="Back"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-ml-2')}
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 space-y-6 px-5 pb-safe pt-6">
        <GoalCreate unit={unit} />

        {evaluated.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-12 text-center">
            <p className="font-medium">No goals yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Set a strength target, a bodyweight target, or a training streak.
            </p>
          </div>
        ) : (
          <section aria-label="Active goals" className="space-y-3">
            {evaluated.map((entry) => (
              <GoalCard key={entry.goal.id} entry={entry} unit={unit} evidence={evidence} />
            ))}
          </section>
        )}

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
                    {goal.achievedAt !== null && (
                      <span className="shrink-0 text-xs uppercase tracking-widest">Achieved</span>
                    )}
                  </div>
                  <GoalCardActions id={goal.id} label={goalLabel(goal, unit)} archived />
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
}: {
  entry: GoalWithProgress
  unit: WeightUnit
  evidence: StreakEvidence | null
}) {
  const { goal, progress } = entry
  const Icon = KIND_ICONS[goal.kind]
  const label = goalLabel(goal, unit)
  const isAchieved = goal.achievedAt !== null

  return (
    <article
      className={cn(
        'rounded-2xl border bg-card p-4',
        isAchieved ? 'border-primary/50' : 'border-border',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="min-w-0 truncate font-display text-lg uppercase leading-tight tracking-wide">
            {label}
          </h2>
        </div>
        {isAchieved && (
          <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary">
            Achieved
          </span>
        )}
      </div>

      <div className="mt-3">
        {progress.kind === 'strength' && (
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted-foreground tnum">
                {progress.bestE1rmKg !== null
                  ? `Best ${formatE1RM(progress.bestE1rmKg, unit)}`
                  : 'No est. 1RM yet'}
              </span>
              <span className="text-xs font-semibold text-muted-foreground tnum">
                {progress.percent}%
              </span>
            </div>
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
            {/* Pace only when the trend honestly supports it — otherwise silence. */}
            {!isAchieved && progress.projectedAt !== null && (
              <p className="mt-2 text-xs text-muted-foreground">
                On pace for {formatWorkoutDate(progress.projectedAt)}
              </p>
            )}
          </div>
        )}

        {progress.kind === 'bodyweight' && (
          <p className="text-sm text-muted-foreground tnum">
            {progress.currentKg !== null
              ? `Now ${kgToDisplay(progress.currentKg, unit)} ${unit}` +
                (progress.remainingKg !== null && progress.remainingKg > 0
                  ? ` · ${kgToDisplay(progress.remainingKg, unit)} ${unit} to go`
                  : '')
              : 'Log your bodyweight to track this goal.'}
          </p>
        )}

        {progress.kind === 'consistency' && evidence !== null && (
          <ConsistencyProgress
            completedAtTimes={evidence.completedAtTimes}
            scheduledWeekdays={evidence.scheduledWeekdays}
            allowedMissesPerWeek={progress.allowedMissesPerWeek}
            targetWeeks={progress.targetWeeks}
          />
        )}
      </div>

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

      <GoalCardActions id={goal.id} label={label} archived={false} />
    </article>
  )
}

/** YYYY-MM-DD → the app's one date wording, parsed as LOCAL midnight (a
 *  deadline is a calendar date, not an instant — no UTC shift). */
function formatDeadline(deadline: string): string {
  const [y, m, d] = deadline.split('-').map(Number)
  return formatWorkoutDate(new Date(y, m - 1, d))
}
