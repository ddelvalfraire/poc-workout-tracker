import Link from 'next/link'
import { listTrophies } from '@/db/trophies'
import { trophyLabel } from '@/lib/goals/trophies'
import type { HomeSectionShape } from '@/lib/home/registry'
import { getTranslations } from 'next-intl/server'
import { cache } from 'react'

/** Rows the tall form shows — a fact wall, not a scrolling ledger. */
const MAX_ROWS = 3

/** en-US matches formatWorkoutDate — one locale for all date display. */
const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

/** This widget's content, or null when it has nothing to say — the ONE
 *  emptiness decision, read by the grid before it packs a cell and again by
 *  the component below, so the two can never disagree. Every reader inside is
 *  request-memoized, so the second read costs no query. See
 *  renderHomeSections. */
export const trophyCaseContent = cache(async (userId: string) => {
  const rows = await listTrophies(userId)
  return rows.length === 0 ? null : rows
})

/**
 * Recently stamped milestones. A fact wall, not a badge shop: every entry is a
 * real threshold that was crossed, stamped with the date it happened.
 *
 * Silent until something has been earned. An empty trophy case is an
 * invitation nobody asked for, and the hero already owns the invitations.
 */
export async function TrophyCase({ userId, shape }: { userId: string; shape: HomeSectionShape }) {
  const t = await getTranslations('TrophyCase')
  const tTrophies = await getTranslations('Trophies')
  const rows = await trophyCaseContent(userId)
  if (rows === null) return null
  const newest = trophyLabel(rows[0].kind)

  return (
    <Link href="/trophies" className="flex h-full flex-col transition-colors active:bg-muted/60">
      <span className="min-w-0 truncate font-display text-[0.66rem] font-medium uppercase leading-none tracking-[0.15em] text-muted-foreground">
        {t('title')}
      </span>

      <span className="mt-2 flex flex-col">
        <span className="flex items-baseline gap-1">
          <span className="font-display text-[2.1rem] font-semibold leading-[0.82] tnum">
            {rows.length}
          </span>
          <span className="text-[0.68rem] font-medium text-muted-foreground">{t('unit')}</span>
        </span>
        <span className="mt-1.5 block truncate text-[0.7rem] text-muted-foreground">
          {tTrophies(newest.key, newest.values)}
        </span>
      </span>

      {shape === 'tall' && (
        <span className="mt-auto flex flex-col pt-2">
          {rows.slice(0, MAX_ROWS).map((row) => {
            const label = trophyLabel(row.kind)
            return (
              <span
                key={row.id}
                className="flex items-baseline justify-between gap-2 border-b border-b-border/60 py-1.5 text-[0.73rem] last:border-b-0"
              >
                <span className="truncate text-muted-foreground">
                  {tTrophies(label.key, label.values)}
                </span>
                <span className="shrink-0 tnum">{dayFormat.format(row.achievedAt)}</span>
              </span>
            )
          })}
        </span>
      )}
    </Link>
  )
}
