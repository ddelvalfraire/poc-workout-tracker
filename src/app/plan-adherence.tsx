import Link from 'next/link'
import { getPlanAdherence } from '@/db/home-adherence'
import type { HomeSectionShape } from '@/lib/home/registry'
import { getTranslations } from 'next-intl/server'
import { cache } from 'react'

/** This widget's content, or null when it has nothing to say — the ONE
 *  emptiness decision, read by the grid before it packs a cell and again by
 *  the component below, so the two can never disagree. Every reader inside is
 *  request-memoized, so the second read costs no query. See
 *  renderHomeSections. */
export const planAdherenceContent = cache(async (userId: string) => getPlanAdherence(userId))

/**
 * Prescribed sets met over the last four weeks.
 *
 * The label says four weeks rather than "this block" because that is what the
 * read actually measures — real block boundaries need program week state and
 * another query, and a label that overclaims its window is worse than a
 * plainer one that is true.
 *
 * Silent for anyone training without a program: with no prescriptions there
 * is nothing to adhere to.
 */
export async function PlanAdherence({
  userId,
  shape,
}: {
  userId: string
  shape: HomeSectionShape
}) {
  const t = await getTranslations('PlanAdherence')
  const adherence = await planAdherenceContent(userId)
  if (adherence === null) return null
  const missed = adherence.total - adherence.hit

  return (
    <Link href="/programs" className="flex h-full flex-col transition-colors active:bg-muted/60">
      <span className="font-display text-[0.66rem] font-medium uppercase leading-none tracking-[0.15em] text-muted-foreground">
        {t('title')}
      </span>

      <span className="mt-auto flex flex-col justify-end">
        <span className="flex items-baseline gap-1">
          <span className="font-display text-[2.1rem] font-semibold leading-[0.82] tnum">
            {adherence.hit}
          </span>
          <span className="text-[0.68rem] font-medium text-muted-foreground">
            {t('of', { total: adherence.total })}
          </span>
        </span>
        {/* The qualifier names what was missed rather than repeating the
            fraction — a second reading of the same number is not a fact. */}
        <span
          className={
            missed > 0
              ? 'mt-1.5 block text-[0.7rem] text-destructive-ink tnum'
              : 'mt-1.5 block text-[0.7rem] text-muted-foreground'
          }
        >
          {missed > 0 ? t('missed', { count: missed }) : t('allHit')}
        </span>
        {shape === 'wide' && (
          <span className="mt-2 block h-[3px] rounded-full bg-white/10">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${Math.round((adherence.hit / adherence.total) * 100)}%` }}
            />
          </span>
        )}
      </span>
    </Link>
  )
}
