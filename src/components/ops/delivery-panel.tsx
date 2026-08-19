import { cn } from '@/lib/utils'
import type { OpsResult } from '@/lib/ops/types'
import type { VercelSnapshot } from '@/lib/ops/vercel'
import type { HealthchecksSnapshot } from '@/lib/ops/healthchecks'
import { formatDurationMs, timeAgo } from '@/lib/ops/time'
import { OpsPanel, statusOf, type OpsPanelStatus } from './panel'

/**
 * Delivery panel: "did the deploy work, and is the cron alive?" — a deploys
 * table (state, commit, age, build duration) over the checks block with each
 * check's recent status flips. Two sources share the panel; each half
 * degrades on its own so a dead Vercel token can't hide a down cron.
 */

const STATE_DOT: Record<string, string> = {
  READY: 'bg-emerald-500',
  ERROR: 'bg-red-500',
  CANCELED: 'bg-red-500',
  BUILDING: 'bg-amber-500',
  QUEUED: 'bg-amber-500',
}

const CHECK_DOT: Record<string, string> = {
  up: 'bg-emerald-500',
  down: 'bg-red-500',
  grace: 'bg-amber-500',
  late: 'bg-amber-500',
  paused: 'bg-muted-foreground/40',
  new: 'bg-muted-foreground/40',
}

interface DeliveryPanelProps {
  vercel: OpsResult<VercelSnapshot>
  healthchecks: OpsResult<HealthchecksSnapshot>
  className?: string
}

/** The panel's headline status: worst of the two sources. */
function combinedStatus(
  vercel: OpsResult<VercelSnapshot>,
  healthchecks: OpsResult<HealthchecksSnapshot>,
): OpsPanelStatus {
  if (vercel.ok || healthchecks.ok) return 'ok'
  const reasons = [statusOf(vercel), statusOf(healthchecks)]
  return reasons.includes('degraded') ? 'degraded' : 'unconfigured'
}

export function DeliveryPanel({ vercel, healthchecks, className }: DeliveryPanelProps) {
  return (
    <OpsPanel
      id="delivery"
      title="Delivery"
      status={combinedStatus(vercel, healthchecks)}
      // Two sources share this panel; surface whichever is served stale.
      staleAt={
        (vercel.ok ? vercel.staleAt : undefined) ??
        (healthchecks.ok ? healthchecks.staleAt : undefined)
      }
      envVar="VERCEL_API_TOKEN"
      link={{ href: 'https://vercel.com/dashboard', label: 'Vercel' }}
      className={className}
    >
      <div className="space-y-5">
        <section aria-label="Production deployments">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Production deploys
          </h3>
          {!vercel.ok ? (
            <SourceDown reason={statusOf(vercel)} envVar="VERCEL_API_TOKEN" />
          ) : vercel.data.deployments.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No production deployments yet.</p>
          ) : (
            <div
                /* A horizontally scrolling region must be reachable by keyboard:
                   without tabindex a keyboard user cannot scroll it at all. */
                tabIndex={0}
                className="mt-2 overflow-x-auto"
              >
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">State</th>
                    <th className="pb-2 pr-3 font-medium">Commit</th>
                    <th className="pb-2 pr-3 text-right font-medium">Age</th>
                    <th className="pb-2 text-right font-medium">Build</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {vercel.data.deployments.map((deploy) => (
                    <tr
                      key={`${deploy.createdAt}-${deploy.url}`}
                      className={cn(deploy.isFailed && 'text-red-400')}
                    >
                      <td className="whitespace-nowrap py-1.5 pr-3">
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={cn(
                              'size-2 shrink-0 rounded-full',
                              STATE_DOT[deploy.state] ?? 'bg-muted-foreground/40',
                            )}
                          />
                          <span
                            className={cn('text-xs font-medium', deploy.isFailed && 'font-semibold')}
                          >
                            {deploy.state}
                          </span>
                        </span>
                      </td>
                      <td className="max-w-0 py-1.5 pr-3">
                        <a
                          href={deploy.url ? `https://${deploy.url}` : undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate hover:underline"
                          title={deploy.commitMessage}
                        >
                          {deploy.sha7 && (
                            <code className="mr-1.5 text-xs text-muted-foreground">
                              {deploy.sha7}
                            </code>
                          )}
                          {deploy.commitMessage || deploy.url}
                        </a>
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-right text-xs text-muted-foreground">
                        {timeAgo(new Date(deploy.createdAt))}
                      </td>
                      <td className="whitespace-nowrap py-1.5 text-right text-xs tnum text-muted-foreground">
                        {formatDurationMs(deploy.durationMs) || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-label="Cron checks">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Cron checks
          </h3>
          {!healthchecks.ok ? (
            <SourceDown reason={statusOf(healthchecks)} envVar="HEALTHCHECKS_API_KEY" />
          ) : healthchecks.data.checks.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No checks configured.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {healthchecks.data.checks.map((check) => (
                <li key={check.name}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'size-2 shrink-0 rounded-full',
                          CHECK_DOT[check.status] ?? 'bg-muted-foreground/40',
                        )}
                      />
                      <span className="truncate text-sm font-medium">{check.name}</span>
                      <span className="text-xs text-muted-foreground">{check.status}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      ping {timeAgo(check.lastPing) || 'never'}
                    </span>
                  </div>
                  {check.flips.length > 0 && (
                    <ul className="mt-1 space-y-0.5 pl-4">
                      {check.flips.map((flip) => (
                        <li
                          key={flip.timestamp}
                          className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground"
                        >
                          <span className={cn(flip.up ? 'text-emerald-500' : 'text-red-400')}>
                            {flip.up ? '↑ up' : '↓ down'}
                          </span>
                          <span>{timeAgo(flip.timestamp)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </OpsPanel>
  )
}

/** Inline degrade line for one half of the panel. */
function SourceDown({ reason, envVar }: { reason: OpsPanelStatus; envVar: string }) {
  return (
    <p className="mt-2 text-sm text-muted-foreground">
      {reason === 'unconfigured' ? (
        <>
          Set{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">{envVar}</code>{' '}
          to light this up.
        </>
      ) : (
        'Upstream did not respond. It refreshes on reload.'
      )}
    </p>
  )
}
