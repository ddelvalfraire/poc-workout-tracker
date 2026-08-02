import { notFound } from 'next/navigation'
import { requireUserId } from '@/lib/auth'
import { isOpsUser } from '@/lib/ops/access'
import { getProductAnalytics, type ProductAnalytics } from '@/lib/ops/product-analytics'
import type { OpsResult } from '@/lib/ops/types'
import { shortDayLabel } from '@/lib/ops/time'
import { OpsHeader } from '@/components/ops/ops-header'
import { OpsPanel, statusOf } from '@/components/ops/panel'
import { MiniBarChart } from '@/components/ops/mini-bar-chart'
import { ActivityLog } from '@/components/ops/activity-log'

/**
 * /ops/product — the Product tab: "is the product being used, and by whom?"
 * KPI row, 30-day usage charts, the feature-adoption table, and the merged
 * cross-source activity log. All first-party Postgres (one OpsResult), so
 * every panel shares one status and degrades together.
 *
 * Gate: identical to /ops (allowlist → notFound), deliberately re-asserted
 * here rather than hoisted into a shared layout — layouts do not re-run on
 * every navigation and can be sidestepped by parallel/intercepting-route
 * quirks, so each ops page owns its own gate.
 */
export const dynamic = 'force-dynamic'

const numberFmt = new Intl.NumberFormat('en-US')

export default async function OpsProductPage() {
  const userId = await requireUserId()
  // Internal surface: 404 for everyone off the allowlist (never a 403).
  if (!isOpsUser(userId)) notFound()

  const analytics = await getProductAnalytics()

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <OpsHeader active="product" />

      <main className="mx-auto w-full max-w-screen-2xl flex-1 px-5 pb-safe pt-5">
        <div className="grid grid-cols-1 gap-4 pb-8 xl:grid-cols-12">
          <UsagePanel analytics={analytics} className="xl:col-span-12" />
          <AdoptionPanel analytics={analytics} className="xl:col-span-5" />
          <ActivityPanel analytics={analytics} className="xl:col-span-7" />
        </div>
      </main>
    </div>
  )
}

interface SectionProps {
  analytics: OpsResult<ProductAnalytics>
  className?: string
}

function UsagePanel({ analytics, className }: SectionProps) {
  return (
    <OpsPanel id="usage" title="Usage" status={statusOf(analytics)} className={className}>
      {analytics.ok && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            <Stat label="Active users 7d" value={analytics.data.kpis.activeUsers7d} />
            <Stat label="Workouts 7d" value={analytics.data.kpis.workouts7d} />
            <Stat label="Workouts 30d" value={analytics.data.kpis.workouts30d} />
            <Stat
              label="Workouts / user 7d"
              value={analytics.data.kpis.avgWorkoutsPerActiveUser7d}
            />
            <Stat label="Push subs" value={analytics.data.kpis.pushSubscriptions} />
            <Stat
              label="Goals active"
              value={analytics.data.kpis.activeGoals}
              hint={`${numberFmt.format(analytics.data.kpis.achievedGoals)} achieved`}
            />
            <Stat label="Photos" value={analytics.data.kpis.photosTotal} />
            <Stat
              label="Programs active"
              value={analytics.data.kpis.programsActive}
              hint={`${numberFmt.format(analytics.data.kpis.programsProposed)} proposed`}
            />
          </dl>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            <ChartSection
              title="Workouts / day · 30d"
              valueLabel="Workouts"
              ariaLabel="Completed workouts per day, last 30 days"
              points={analytics.data.workoutsPerDay}
            />
            <ChartSection
              title="Active users / day · 30d"
              valueLabel="Users"
              ariaLabel="Distinct active users per day, last 30 days"
              points={analytics.data.activeUsersPerDay}
            />
            <ChartSection
              title="Goals achieved / day · 30d"
              valueLabel="Goals"
              ariaLabel="Goals achieved per day, last 30 days"
              points={analytics.data.goalsAchievedPerDay}
            />
          </div>
        </>
      )}
    </OpsPanel>
  )
}

function AdoptionPanel({ analytics, className }: SectionProps) {
  return (
    <OpsPanel id="adoption" title="Adoption" status={statusOf(analytics)} className={className}>
      {analytics.ok && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="pb-2 font-medium">
                Feature
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                7d
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                30d
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                All
              </th>
            </tr>
          </thead>
          <tbody>
            {analytics.data.adoption.map((row) => (
              <tr key={row.feature} className="border-t border-border/60">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                  {row.feature}
                </th>
                <td className="py-1.5 text-right tnum">{numberFmt.format(row.count7d)}</td>
                <td className="py-1.5 text-right tnum">{numberFmt.format(row.count30d)}</td>
                <td className="py-1.5 text-right tnum">{numberFmt.format(row.countAll)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </OpsPanel>
  )
}

function ActivityPanel({ analytics, className }: SectionProps) {
  return (
    <OpsPanel id="activity" title="Activity" status={statusOf(analytics)} className={className}>
      {analytics.ok && <ActivityLog items={analytics.data.activity} />}
    </OpsPanel>
  )
}

function ChartSection({
  title,
  valueLabel,
  ariaLabel,
  points,
}: {
  title: string
  valueLabel: string
  ariaLabel: string
  points: { day: string; value: number }[]
}) {
  return (
    <section aria-label={title}>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      <div className="mt-1.5">
        <MiniBarChart
          points={points.map((p) => ({ label: shortDayLabel(p.day), value: p.value }))}
          valueLabel={valueLabel}
          ariaLabel={ariaLabel}
        />
      </div>
    </section>
  )
}

/** A compact metric tile in the KPI row. */
function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-2xl font-semibold leading-none tnum">
        {numberFmt.format(value)}
      </dd>
      {hint && <dd className="mt-1 text-xs text-muted-foreground">{hint}</dd>}
    </div>
  )
}
