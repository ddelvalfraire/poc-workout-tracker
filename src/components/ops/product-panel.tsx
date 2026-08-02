import type { OpsResult } from '@/lib/ops/types'
import type { AppVitals } from '@/lib/ops/app-vitals'
import { shortDayLabel, timeAgo } from '@/lib/ops/time'
import { OpsPanel, statusOf } from './panel'
import { MiniBarChart } from './mini-bar-chart'

/**
 * Product panel: "is the product being used?" — 14-day workouts/day and
 * active-users/day mini charts, the headline totals, the program change-log
 * feed, and the latest completed sessions. All first-party Postgres; no
 * vendor to deep-link to.
 */

interface ProductPanelProps {
  vitals: OpsResult<AppVitals>
  className?: string
}

const numberFmt = new Intl.NumberFormat('en-US')

export function ProductPanel({ vitals, className }: ProductPanelProps) {
  return (
    <OpsPanel id="product" title="Product" status={statusOf(vitals)} className={className}>
      {vitals.ok && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Workouts 7d" value={vitals.data.workoutsCompleted7d} />
            <Stat label="Users 7d" value={vitals.data.activeUsers7d} />
            <Stat label="Push subs" value={vitals.data.pushSubscriptions} />
            <Stat label="Goals" value={vitals.data.activeGoals} />
            <Stat label="Proposals" value={vitals.data.pendingProposals} />
          </dl>

          <div className="mt-5 space-y-4">
            <section aria-label="Workouts per day">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Workouts / day · 14d
              </h3>
              <div className="mt-1.5">
                <MiniBarChart
                  points={vitals.data.workoutsPerDay.map((p) => ({
                    label: shortDayLabel(p.day),
                    value: p.value,
                  }))}
                  valueLabel="Workouts"
                  ariaLabel="Completed workouts per day, last 14 days"
                />
              </div>
            </section>
            <section aria-label="Active users per day">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Active users / day · 14d
              </h3>
              <div className="mt-1.5">
                <MiniBarChart
                  points={vitals.data.activeUsersPerDay.map((p) => ({
                    label: shortDayLabel(p.day),
                    value: p.value,
                  }))}
                  valueLabel="Users"
                  ariaLabel="Distinct active users per day, last 14 days"
                />
              </div>
            </section>
          </div>

          <section aria-label="Recent workouts" className="mt-5">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Recent workouts
            </h3>
            {vitals.data.recentWorkouts.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No completed workouts yet.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {vitals.data.recentWorkouts.map((workout, index) => (
                  <li
                    key={`${workout.startedAt.toISOString()}-${index}`}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate font-medium">
                      {workout.name ?? 'Workout'}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      <span className="tnum">
                        {numberFmt.format(Math.round(workout.volumeKg))} kg
                      </span>
                      {' · '}
                      {timeAgo(workout.startedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Program changes" className="mt-5">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Program changes
            </h3>
            {vitals.data.recentEvents.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No program changes yet.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {vitals.data.recentEvents.map((event, index) => (
                  <li
                    key={`${event.occurredAt.toISOString()}-${index}`}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      <span className="text-muted-foreground">[{event.actor}]</span> {event.summary}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {timeAgo(event.occurredAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </OpsPanel>
  )
}

/** A compact metric tile in the panel's totals row. */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-2xl font-semibold leading-none tnum">{numberFmt.format(value)}</dd>
    </div>
  )
}
