import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { isOpsUser } from '@/lib/ops/access'
import { getSentryIssues, type SentrySnapshot } from '@/lib/ops/sentry'
import { getHealthchecks, type HealthchecksSnapshot } from '@/lib/ops/healthchecks'
import { getLangfuseDaily, getLangfuseTraces, type LangfuseSnapshot } from '@/lib/ops/langfuse'
import { getVercelDeployments, type VercelSnapshot } from '@/lib/ops/vercel'
import { getAppVitals, type AppVitals } from '@/lib/ops/app-vitals'
import type { OpsResult } from '@/lib/ops/types'
import { StatusStrip, type StatusPill } from '@/components/ops/status-strip'
import { ErrorsPanel } from '@/components/ops/errors-panel'
import { DeliveryPanel } from '@/components/ops/delivery-panel'
import { CoachPanel } from '@/components/ops/coach-panel'
import { ProductPanel } from '@/components/ops/product-panel'
import { OpsRefreshButton } from '@/components/ops/refresh-button'
import { AutoRefreshToggle } from '@/components/ops/auto-refresh-toggle'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * /ops v2 — the internal aggregation board, desktop-first. One page that
 * actually answers the five operator questions (health strip, errors table,
 * delivery, coach usage/cost, product usage) without opening a vendor tab.
 * The layout targets >=1280px: a 12-column grid with dense 7/5-column
 * panels; everything stacks on small screens.
 *
 * Gated hard: allowlist-only (OPS_ALLOWED_USER_IDS), and a non-member gets
 * notFound() — a 404, not a 403, so the route never admits it exists. There
 * is NO public nav entry; /ops is reached by URL (plus a link on /settings
 * that only allowlisted users see).
 *
 * Always live: force-dynamic + every source fetched fresh per render (each
 * with its own 5s timeout and soft-fail). A source going dark degrades ITS
 * panel only — the board never blanks. BOTH Sentry windows (24h and 14d)
 * are fetched up front so the errors toggle is pure client state — flipping
 * it must never re-render the page and re-hit all five vendors (fixed
 * windows everywhere else, by design).
 */
export const dynamic = 'force-dynamic'

/** Levels that turn the errors pill red rather than amber. */
const LOUD_LEVELS = new Set(['error', 'fatal'])

function buildPills(
  vercel: OpsResult<VercelSnapshot>,
  healthchecks: OpsResult<HealthchecksSnapshot>,
  sentry: OpsResult<SentrySnapshot>,
  langfuse: OpsResult<LangfuseSnapshot>,
  vitals: OpsResult<AppVitals>,
): StatusPill[] {
  const latestDeploy = vercel.ok ? vercel.data.deployments[0] : undefined
  const deployPill: StatusPill = {
    href: '#delivery',
    label: 'Deploy',
    value: latestDeploy?.state ?? '—',
    tone: !latestDeploy
      ? 'muted'
      : latestDeploy.isFailed
        ? 'bad'
        : latestDeploy.state === 'READY'
          ? 'ok'
          : 'warn',
  }
  const cronPill: StatusPill = {
    href: '#delivery',
    label: 'Cron',
    value: !healthchecks.ok
      ? '—'
      : healthchecks.data.downCount === 0
        ? 'up'
        : `${healthchecks.data.downCount} down`,
    tone: !healthchecks.ok ? 'muted' : healthchecks.data.downCount === 0 ? 'ok' : 'bad',
  }
  const errorsPill: StatusPill = {
    href: '#errors',
    label: sentry.ok ? `Errors ${sentry.data.period}` : 'Errors',
    value: sentry.ok ? String(sentry.data.unresolvedCount) : '—',
    tone: !sentry.ok
      ? 'muted'
      : sentry.data.unresolvedCount === 0
        ? 'ok'
        : sentry.data.topIssues.some((i) => LOUD_LEVELS.has(i.level))
          ? 'bad'
          : 'warn',
  }
  const coachPill: StatusPill = {
    href: '#coach',
    label: 'Coach 7d',
    value: langfuse.ok ? `$${langfuse.data.totalCost7d.toFixed(2)}` : '—',
    tone: langfuse.ok ? 'ok' : 'muted',
  }
  const usersPill: StatusPill = {
    href: '#product',
    label: 'Users 7d',
    value: vitals.ok ? String(vitals.data.activeUsers7d) : '—',
    tone: vitals.ok ? 'ok' : 'muted',
  }
  return [deployPill, cronPill, errorsPill, coachPill, usersPill]
}

export default async function OpsPage() {
  const userId = await requireUserId()
  // Internal surface: 404 for everyone off the allowlist (never a 403).
  if (!isOpsUser(userId)) notFound()

  // Every source in parallel — no waterfalls. Each already fails soft.
  // Both Sentry windows ride the same batch (one extra top-10 read) so the
  // panel's toggle stays client-local.
  const [sentry, sentry14d, healthchecks, langfuse, langfuseTraces, vercel, vitals] =
    await Promise.all([
      getSentryIssues('24h'),
      getSentryIssues('14d'),
      getHealthchecks(),
      getLangfuseDaily(),
      getLangfuseTraces(),
      getVercelDeployments(),
      getAppVitals(),
    ])

  const sentryOrg = process.env.SENTRY_ORG_SLUG
  const sentryProject = process.env.SENTRY_PROJECT_SLUG
  const sentryUrl =
    sentryOrg && sentryProject
      ? `https://sentry.io/organizations/${sentryOrg}/projects/${sentryProject}/`
      : 'https://sentry.io/'

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {/* Desktop-scale header: full-width, unlike AppHeader's max-w-md phone bar. */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-safe pt-safe backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-screen-2xl items-center gap-2 px-5">
          <Link
            href="/"
            aria-label="Back"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-ml-2')}
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-xl uppercase tracking-tight">Ops</h1>
          <AutoRefreshToggle />
          <OpsRefreshButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-screen-2xl flex-1 px-5 pb-safe pt-5">
        <StatusStrip pills={buildPills(vercel, healthchecks, sentry, langfuse, vitals)} />

        <div className="mt-5 grid grid-cols-1 gap-4 pb-8 xl:grid-cols-12">
          <ErrorsPanel
            results={{ '24h': sentry, '14d': sentry14d }}
            sentryUrl={sentryUrl}
            className="xl:col-span-7"
          />
          <DeliveryPanel vercel={vercel} healthchecks={healthchecks} className="xl:col-span-5" />
          <CoachPanel daily={langfuse} traces={langfuseTraces} className="xl:col-span-7" />
          <ProductPanel vitals={vitals} className="xl:col-span-5" />
        </div>
      </main>
    </div>
  )
}
