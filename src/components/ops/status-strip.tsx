import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

/**
 * Row 1 of the ops board: the 2-second "is prod healthy?" answer. Five
 * compact pills — deploy state, cron, errors, coach cost, active users —
 * each with a red/amber/green dot and an in-page anchor down to its panel.
 * Server-renderable; the page computes tone + value per pill.
 */

export type PillTone = 'ok' | 'warn' | 'bad' | 'muted'

export interface StatusPill {
  /** In-page anchor to the pill's panel, e.g. "#errors". */
  href: string
  label: string
  value: string
  tone: PillTone
}

const DOT: Record<PillTone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  muted: 'bg-muted-foreground/40',
}

export function StatusStrip({ pills }: { pills: StatusPill[] }) {
  const t = useTranslations('StatusStrip')
  return (
    <nav aria-label={t('navLabel')} className="flex flex-wrap gap-2">
      {pills.map((pill) => (
        <a
          key={pill.href}
          href={pill.href}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 outline-none transition-colors hover:border-muted-foreground/40 focus-visible:border-primary"
        >
          <span className={cn('size-2 shrink-0 rounded-full', DOT[pill.tone])} aria-hidden="true" />
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {pill.label}
          </span>
          <span className="text-sm font-semibold tnum">{pill.value}</span>
        </a>
      ))}
    </nav>
  )
}
