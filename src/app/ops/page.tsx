import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { isOpsUser } from '@/lib/ops/access'
import { getSentryIssues } from '@/lib/ops/sentry'
import { getHealthchecks } from '@/lib/ops/healthchecks'
import { getLangfuseDaily } from '@/lib/ops/langfuse'
import { getVercelDeployments } from '@/lib/ops/vercel'
import { getAppVitals } from '@/lib/ops/app-vitals'
import type { OpsResult } from '@/lib/ops/types'
import { AppHeader } from '@/components/app-header'
import { OpsCard, type OpsCardStatus } from '@/components/ops/ops-card'
import { OpsRefreshButton } from '@/components/ops/refresh-button'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * /ops — the internal aggregation board. One place to see Sentry, Healthchecks,
 * Langfuse, Vercel, and our own DB vitals, so nobody opens five vendor tabs.
 *
 * Gated hard: allowlist-only (OPS_ALLOWED_USER_IDS), and a non-member gets
 * notFound() — a 404, not a 403, so the route never admits it exists. There
 * is NO public nav entry; /ops is reached by URL (plus a link on /settings
 * that only allowlisted users see).
 *
 * Always live: force-dynamic + every source fetched fresh per render (each
 * with its own 5s timeout and soft-fail). A source going dark degrades ITS
 * card only — the board never blanks.
 */
export const dynamic = 'force-dynamic'

/** Maps a source result to the card's status dot. */
function statusOf(result: OpsResult<unknown>): OpsCardStatus {
  if (result.ok) return 'ok'
  return result.reason === 'unconfigured' ? 'unconfigured' : 'degraded'
}

/** Compact "3h ago" / "2d ago" from a Date or ISO string; '' when unusable. */
function timeAgo(value: Date | string | null): string {
  if (!value) return ''
  const then = value instanceof Date ? value.getTime() : Date.parse(value)
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

const numberFmt = new Intl.NumberFormat('en-US')

export default async function OpsPage() {
  const userId = await requireUserId()
  // Internal surface: 404 for everyone off the allowlist (never a 403).
  if (!isOpsUser(userId)) notFound()

  // Every source in parallel — no waterfalls. Each already fails soft.
  const [sentry, healthchecks, langfuse, vercel, vitals] = await Promise.all([
    getSentryIssues(),
    getHealthchecks(),
    getLangfuseDaily(),
    getVercelDeployments(),
    getAppVitals(),
  ])

  const sentryOrg = process.env.SENTRY_ORG_SLUG
  const sentryProject = process.env.SENTRY_PROJECT_SLUG
  const sentryLink =
    sentryOrg && sentryProject
      ? `https://sentry.io/organizations/${sentryOrg}/projects/${sentryProject}/`
      : 'https://sentry.io/'

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Ops"
        leading={
          <Link
            href="/"
            aria-label="Back"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-ml-2')}
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </Link>
        }
        trailing={<OpsRefreshButton />}
      />

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pb-safe pt-6">
        <p className="px-1 text-sm text-muted-foreground">
          Internal board — every source pulled live on load. Cards degrade on their own; the rest
          stay up.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {/* Sentry — unresolved issues, last 24h. */}
          <OpsCard
            title="Sentry"
            status={statusOf(sentry)}
            envVar="SENTRY_API_TOKEN"
            link={{ href: sentryLink, label: 'Open Sentry' }}
          >
            {sentry.ok && (
              <>
                <p className="text-3xl font-semibold leading-none">
                  {numberFmt.format(sentry.data.unresolvedCount)}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    unresolved · 24h
                  </span>
                </p>
                <ul className="mt-3 space-y-1.5">
                  {sentry.data.topIssues.map((issue) => (
                    <li key={issue.permalink} className="flex items-baseline justify-between gap-3">
                      <a
                        href={issue.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 truncate text-sm text-foreground hover:underline"
                      >
                        {issue.title}
                      </a>
                      <span className="shrink-0 text-xs tnum text-muted-foreground">
                        {issue.count}
                      </span>
                    </li>
                  ))}
                  {sentry.data.topIssues.length === 0 && (
                    <li className="text-sm text-muted-foreground">No unresolved issues. Clean.</li>
                  )}
                </ul>
              </>
            )}
          </OpsCard>

          {/* Healthchecks — cron liveness. */}
          <OpsCard
            title="Healthchecks"
            status={statusOf(healthchecks)}
            envVar="HEALTHCHECKS_API_KEY"
            link={{ href: 'https://healthchecks.io/', label: 'Open Healthchecks' }}
          >
            {healthchecks.ok && (
              <>
                <p className="text-3xl font-semibold leading-none">
                  {healthchecks.data.downCount === 0
                    ? 'All up'
                    : `${healthchecks.data.downCount} down`}
                </p>
                <ul className="mt-3 space-y-1.5">
                  {healthchecks.data.checks.map((check) => (
                    <li key={check.name} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm text-foreground">{check.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {check.status} · {timeAgo(check.lastPing) || 'never'}
                      </span>
                    </li>
                  ))}
                  {healthchecks.data.checks.length === 0 && (
                    <li className="text-sm text-muted-foreground">No checks configured.</li>
                  )}
                </ul>
              </>
            )}
          </OpsCard>

          {/* Langfuse — coach telemetry, 7-day. */}
          <OpsCard
            title="Langfuse"
            status={statusOf(langfuse)}
            envVar="LANGFUSE_PUBLIC_KEY"
            link={{ href: 'https://cloud.langfuse.com/', label: 'Open Langfuse' }}
          >
            {langfuse.ok && (
              <>
                <p className="text-3xl font-semibold leading-none">
                  {numberFmt.format(langfuse.data.totalTraces)}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">traces · 7d</span>
                </p>
                <dl className="mt-3 space-y-1 text-sm text-muted-foreground">
                  <div className="flex justify-between gap-3">
                    <dt>Cost (7d)</dt>
                    <dd className="tnum text-foreground">${langfuse.data.totalCost.toFixed(2)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Days reported</dt>
                    <dd className="tnum text-foreground">{langfuse.data.days.length}</dd>
                  </div>
                </dl>
              </>
            )}
          </OpsCard>

          {/* Vercel — latest production deployments. */}
          <OpsCard
            title="Vercel"
            status={statusOf(vercel)}
            envVar="VERCEL_API_TOKEN"
            link={{ href: 'https://vercel.com/dashboard', label: 'Open Vercel' }}
          >
            {vercel.ok && (
              <>
                <p className="text-3xl font-semibold leading-none">
                  {vercel.data.deployments[0]?.state ?? 'No deploys'}
                  {vercel.data.deployments[0] && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {timeAgo(new Date(vercel.data.deployments[0].created))}
                    </span>
                  )}
                </p>
                <ul className="mt-3 space-y-1.5">
                  {vercel.data.deployments.map((deploy) => (
                    <li key={deploy.created} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm text-foreground">{deploy.url}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{deploy.state}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </OpsCard>

          {/* App vitals — our own Postgres. Spans both columns for the event log. */}
          <OpsCard title="App vitals" status={statusOf(vitals)} className="sm:col-span-2">
            {vitals.ok && (
              <>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <VitalTile label="Workouts 7d" value={vitals.data.workoutsCompleted7d} />
                  <VitalTile label="Active users 7d" value={vitals.data.activeUsers7d} />
                  <VitalTile label="Push subs" value={vitals.data.pushSubscriptions} />
                  <VitalTile label="Active goals" value={vitals.data.activeGoals} />
                  <VitalTile label="Proposals" value={vitals.data.pendingProposals} />
                </dl>
                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Recent program changes
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {vitals.data.recentEvents.map((event, index) => (
                      <li
                        key={`${event.occurredAt.toISOString()}-${index}`}
                        className="flex items-baseline justify-between gap-3"
                      >
                        <span className="min-w-0 truncate text-sm text-foreground">
                          <span className="text-muted-foreground">[{event.actor}]</span>{' '}
                          {event.summary}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {timeAgo(event.occurredAt)}
                        </span>
                      </li>
                    ))}
                    {vitals.data.recentEvents.length === 0 && (
                      <li className="text-sm text-muted-foreground">No program changes yet.</li>
                    )}
                  </ul>
                </div>
              </>
            )}
          </OpsCard>
        </div>
      </main>
    </div>
  )
}

/** A compact metric within the app-vitals card (not the shared StatTile — no dl semantics here). */
function VitalTile({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-2xl font-semibold leading-none tnum">{numberFmt.format(value)}</dd>
    </div>
  )
}
