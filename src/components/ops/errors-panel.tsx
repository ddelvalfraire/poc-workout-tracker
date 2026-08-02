import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { OpsResult } from '@/lib/ops/types'
import type { SentryPeriod, SentrySnapshot } from '@/lib/ops/sentry'
import { timeAgo } from '@/lib/ops/time'
import { OpsPanel, statusOf } from './panel'

/**
 * Errors panel: the full Sentry triage table — level, title (deep-linked),
 * culprit, event count, users affected, first/last seen — with a 24h/14d
 * window toggle. The toggle is a plain Link searchParam (?errors=14d) so the
 * page stays a server component; Sentry's issues API only accepts 24h/14d
 * (7d is a 400 — verified live).
 */

const LEVEL_DOT: Record<string, string> = {
  fatal: 'bg-red-600',
  error: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-sky-500',
}

const PERIODS: SentryPeriod[] = ['24h', '14d']

interface ErrorsPanelProps {
  result: OpsResult<SentrySnapshot>
  period: SentryPeriod
  /** Vendor dashboard deep link (org/project resolved by the page). */
  sentryUrl: string
  className?: string
}

export function ErrorsPanel({ result, period, sentryUrl, className }: ErrorsPanelProps) {
  return (
    <OpsPanel
      id="errors"
      title="Errors"
      status={statusOf(result)}
      envVar="SENTRY_API_TOKEN"
      link={{ href: sentryUrl, label: 'Sentry' }}
      className={className}
    >
      {result.ok && (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-3xl font-semibold leading-none tnum">
              {result.data.unresolvedCount}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                unresolved · {result.data.period}
              </span>
            </p>
            <div className="flex gap-1" role="group" aria-label="Errors window">
              {PERIODS.map((p) => (
                <Link
                  key={p}
                  href={p === '24h' ? '/ops' : `/ops?errors=${p}`}
                  replace
                  scroll={false}
                  aria-current={p === period ? 'true' : undefined}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:underline',
                    p === period
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted/50',
                  )}
                >
                  {p}
                </Link>
              ))}
            </div>
          </div>

          {result.data.topIssues.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No unresolved issues. Clean.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Issue</th>
                    <th className="pb-2 pr-3 text-right font-medium">Events</th>
                    <th className="pb-2 pr-3 text-right font-medium">Users</th>
                    <th className="pb-2 pr-3 text-right font-medium">First</th>
                    <th className="pb-2 text-right font-medium">Last</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {result.data.topIssues.map((issue) => (
                    <tr key={issue.permalink}>
                      <td className="max-w-0 py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <span
                            title={issue.level}
                            aria-label={issue.level}
                            className={cn(
                              'size-2 shrink-0 rounded-full',
                              LEVEL_DOT[issue.level] ?? 'bg-muted-foreground/40',
                            )}
                          />
                          <a
                            href={issue.permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-w-0 truncate font-medium text-foreground hover:underline"
                          >
                            {issue.title}
                          </a>
                        </div>
                        {issue.culprit && (
                          <p className="mt-0.5 truncate pl-4 text-xs text-muted-foreground">
                            {issue.culprit}
                          </p>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right align-top text-xs tnum">{issue.count}</td>
                      <td className="py-2 pr-3 text-right align-top text-xs tnum">
                        {issue.userCount}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right align-top text-xs text-muted-foreground">
                        {timeAgo(issue.firstSeen) || '—'}
                      </td>
                      <td className="whitespace-nowrap py-2 text-right align-top text-xs text-muted-foreground">
                        {timeAgo(issue.lastSeen) || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </OpsPanel>
  )
}
