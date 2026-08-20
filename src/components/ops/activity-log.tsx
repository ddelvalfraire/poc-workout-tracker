'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  filterActivity,
  type ActivityItem,
  type ActivityType,
} from '@/lib/ops/activity'
import { timeAgo } from '@/lib/ops/time'
import { useTranslations } from 'next-intl'

/**
 * The /ops/product activity log: filter chips over the pre-merged cross-source
 * feed. Client island only for the chip state — the server already merged and
 * capped the rows, so toggling a chip never re-fetches. Empty selection means
 * "show everything" (filterActivity's contract), so the log can't be blanked.
 */

interface ActivityLogProps {
  items: ActivityItem[]
}

/** Type badge tint per source — semantic, matching each feature's surface. */
const BADGE: Record<ActivityType, string> = {
  workout: 'bg-primary/10 text-primary',
  // violet-400 in dark, like every sibling below: violet-500 on its own
  // 10% tint is 3.84:1. The lighter step clears AA at 5.97:1.
  program: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  goal: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  photo: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  measurement: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  bodyweight: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
}

export function ActivityLog({ items }: ActivityLogProps) {
  const t = useTranslations('ActivityLog')
  const [active, setActive] = useState<ReadonlySet<ActivityType>>(new Set())

  const toggle = (type: ActivityType) => {
    setActive((previous) => {
      const next = new Set(previous)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const visible = filterActivity(items, active)

  return (
    <div>
      <div role="group" aria-label={t('filterGroupLabel')} className="flex flex-wrap gap-1.5">
        {ACTIVITY_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={active.has(type)}
            onClick={() => toggle(type)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs outline-none transition-colors',
              active.has(type)
                ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
                : 'border-border text-muted-foreground hover:border-muted-foreground/40 focus-visible:border-primary',
            )}
          >
            {ACTIVITY_TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {visible.map((item, index) => (
            <li
              key={`${item.type}-${item.at.toISOString()}-${index}`}
              className="flex items-baseline gap-2 text-sm"
            >
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                  BADGE[item.type],
                )}
              >
                {ACTIVITY_TYPE_LABELS[item.type]}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.line}</span>
              {/* suppressHydrationWarning: "Ns ago" legitimately drifts between
                  server render and hydration. */}
              <span suppressHydrationWarning className="shrink-0 text-xs text-muted-foreground">
                {timeAgo(item.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
