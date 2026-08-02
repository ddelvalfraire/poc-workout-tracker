import type { ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OpsResult } from '@/lib/ops/types'
import { timeAgo } from '@/lib/ops/time'

/**
 * One panel on the v2 ops board — the desktop-scale successor to v1's
 * OpsCard. Presentational and server-renderable: the page resolves each
 * source to a status + content and hands it here.
 *
 * - 'ok'          — live data, emerald dot.
 * - 'degraded'    — configured but the upstream failed/timed out, amber dot.
 * - 'unconfigured'— an env var is missing; the panel names it, muted dot.
 *
 * `id` anchors the status strip's pills (#errors, #delivery, ...). The deep
 * link jumps to the vendor dashboard for anything deeper than the panel shows.
 */

export type OpsPanelStatus = 'ok' | 'degraded' | 'unconfigured'

/** Maps a source result to the panel's status dot. */
export function statusOf(result: OpsResult<unknown>): OpsPanelStatus {
  if (result.ok) return 'ok'
  return result.reason === 'unconfigured' ? 'unconfigured' : 'degraded'
}

interface OpsPanelProps {
  /** Anchor id the status strip links to. */
  id: string
  title: string
  status: OpsPanelStatus
  /** Deep link out to the vendor dashboard ("Sentry ↗"). */
  link?: { href: string; label: string }
  /** The env var to set — shown only when unconfigured. */
  envVar?: string
  /** ISO time of the cached copy when the vendor is down (OpsResult.staleAt). */
  staleAt?: string
  /** Grid-span override (col-span-*). */
  className?: string
  children?: ReactNode
}

const DOT: Record<OpsPanelStatus, string> = {
  ok: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  unconfigured: 'bg-muted-foreground/40',
}

const STATUS_LABEL: Record<OpsPanelStatus, string> = {
  ok: 'Live',
  degraded: 'Unavailable',
  unconfigured: 'Not configured',
}

export function OpsPanel({
  id,
  title,
  status,
  link,
  envVar,
  staleAt,
  className,
  children,
}: OpsPanelProps) {
  return (
    <section
      id={id}
      // scroll-mt clears the sticky header when a status-strip pill anchors here.
      className={cn('flex scroll-mt-20 flex-col rounded-2xl border border-border bg-card p-5', className)}
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn('size-2 shrink-0 rounded-full', DOT[status])} aria-hidden="true" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            {title}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {/* Stale-serve note: the vendor is down, a cached copy is shown. */}
          {staleAt && (
            <span className="text-xs text-muted-foreground">as of {timeAgo(staleAt)}</span>
          )}
          <span className="text-xs text-muted-foreground">{STATUS_LABEL[status]}</span>
          {link && (
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-xs font-medium text-primary outline-none hover:underline focus-visible:underline"
            >
              {link.label}
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
            </a>
          )}
        </div>
      </header>

      <div className="mt-4 flex-1">
        {status === 'unconfigured' ? (
          <p className="text-sm text-muted-foreground">
            Set{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">{envVar}</code>{' '}
            to light this up.
          </p>
        ) : status === 'degraded' ? (
          <p className="text-sm text-muted-foreground">
            Upstream did not respond. It refreshes on reload.
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  )
}
