import type { ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * One source tile on the ops board. Presentational and server-renderable —
 * the page resolves each source to a status + content and hands it here.
 *
 * - 'ok'          — live data, emerald dot.
 * - 'degraded'    — configured but the upstream failed/timed out, amber dot.
 * - 'unconfigured'— an env var is missing; the card names it, muted dot.
 *
 * The deep link is the whole point: each card jumps straight to the vendor
 * dashboard so the operator never hunts across tabs.
 */

export type OpsCardStatus = 'ok' | 'degraded' | 'unconfigured'

interface OpsLink {
  href: string
  label: string
}

interface OpsCardProps {
  title: string
  status: OpsCardStatus
  /** Deep link out to the vendor dashboard ("open Sentry →"). */
  link?: OpsLink
  /** The env var to set — shown only when unconfigured. */
  envVar?: string
  /** Degraded reason copy — shown only when degraded. */
  degradedNote?: string
  /** Grid-span override, e.g. the app-vitals card claims both columns. */
  className?: string
  children?: ReactNode
}

const DOT: Record<OpsCardStatus, string> = {
  ok: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  unconfigured: 'bg-muted-foreground/40',
}

const STATUS_LABEL: Record<OpsCardStatus, string> = {
  ok: 'Live',
  degraded: 'Unavailable',
  unconfigured: 'Not configured',
}

export function OpsCard({
  title,
  status,
  link,
  envVar,
  degradedNote,
  className,
  children,
}: OpsCardProps) {
  return (
    <section className={cn('flex flex-col rounded-2xl border border-border bg-card p-5', className)}>
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn('size-2 shrink-0 rounded-full', DOT[status])} aria-hidden="true" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            {title}
          </h2>
        </div>
        <span className="text-xs text-muted-foreground">{STATUS_LABEL[status]}</span>
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
            {degradedNote ?? 'Upstream did not respond. It refreshes on reload.'}
          </p>
        ) : (
          children
        )}
      </div>

      {link && (
        <a
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary outline-none hover:underline focus-visible:underline"
        >
          {link.label}
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </a>
      )}
    </section>
  )
}
