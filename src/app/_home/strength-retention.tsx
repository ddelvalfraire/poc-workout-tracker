import Link from 'next/link'
import { getStrengthRetention } from '@/db/home-adherence'
import { getWeightUnit } from '@/db/preferences'
import { formatVolumeParts } from '@/lib/format'
import type { HomeSectionShape } from '@/lib/home/registry'
import type { CanonicalLift } from '@/lib/trophy-kinds'
import { getTranslations } from 'next-intl/server'
import { cache } from 'react'

const LIFT_ORDER: readonly CanonicalLift[] = ['squat', 'bench', 'deadlift', 'ohp']

/** This widget's content, or null when it has nothing to say — the ONE
 *  emptiness decision, read by the grid before it packs a cell and again by
 *  the component below, so the two can never disagree. Every reader inside is
 *  request-memoized, so the second read costs no query. See
 *  renderHomeSections. */
export const strengthRetentionContent = cache(async (userId: string) => {
  const [retention, unit] = await Promise.all([getStrengthRetention(userId), getWeightUnit(userId)])
  return retention === null ? null : { retention, unit }
})

/**
 * How much strength survived the current diet phase — the reassurance a cut
 * is otherwise missing, since bodyweight falls and nothing else says whether
 * that cost anything.
 *
 * Silent unless a diet phase is set AND some lift has a best on both sides of
 * it. There is no honest version of this widget without a before.
 */
export async function StrengthRetention({
  userId,
  shape,
}: {
  userId: string
  shape: HomeSectionShape
}) {
  const t = await getTranslations('StrengthRetention')
  const content = await strengthRetentionContent(userId)
  if (content === null) return null
  const { retention, unit } = content

  const rows = LIFT_ORDER.flatMap((lift) => {
    const held = retention.lifts[lift]
    return held === undefined ? [] : [{ lift, held }]
  })

  return (
    <Link href="/stats" className="flex h-full flex-col transition-colors active:bg-muted/60">
      <span className="min-w-0 truncate font-display text-[0.66rem] font-medium uppercase leading-none tracking-[0.15em] text-muted-foreground">
        {t('title')}
      </span>

      <span className="mt-2 flex flex-col">
        <span className="flex items-baseline gap-1">
          <span className="font-display text-[3.1rem] font-semibold leading-[0.82] tnum">
            {retention.percent}
          </span>
          <span className="text-[0.68rem] font-medium text-muted-foreground">%</span>
        </span>
        <span className="mt-1.5 block text-[0.7rem] text-muted-foreground">
          {t(`caption.${retention.phase === 'cutting' ? 'cutting' : 'phase'}`)}
        </span>
      </span>

      {/* Only `tall` has room for the per-lift breakdown. The arrow states the
          direction so the row is not colour-only. */}
      {shape === 'tall' && rows.length > 0 && (
        <span className="mt-auto flex flex-col pt-2">
          {rows.slice(0, 3).map(({ lift, held }) => {
            const value = formatVolumeParts(held.sinceKg, unit)
            const grew = held.percent > 100
            const held100 = held.percent === 100
            return (
              <span
                key={lift}
                className="flex items-baseline justify-between gap-2 border-b border-b-border/60 py-1.5 text-[0.73rem] last:border-b-0"
              >
                <span className="text-muted-foreground">{t(`lift.${lift}`)}</span>
                <span className="font-medium tnum">
                  {value.value}
                  <span className={grew ? 'text-primary' : 'text-muted-foreground'}>
                    {' '}
                    {grew ? t('dir.up') : held100 ? t('dir.level') : t('dir.down')}
                  </span>
                </span>
              </span>
            )
          })}
        </span>
      )}
    </Link>
  )
}
