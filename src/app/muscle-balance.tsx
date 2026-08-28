import Link from 'next/link'
import { getRollingMuscleVolume } from '@/db/muscle-volume'
import { getPlannedWeeklyVolume } from '@/db/planned-volume'
import { aggregateVolumeBalance, type GroupBalance } from '@/lib/home/balance'
import type { HomeSectionShape } from '@/lib/home/registry'
import { getTranslations } from 'next-intl/server'

/** How many groups the block form shows. More than five turns a glanceable
 *  bar chart into a table nobody reads on a phone. */
const MAX_ROWS = 5

/** Bars are ordered worst-first: the reason to open this widget is to find
 *  what is behind, not to admire what is done. */
function byShortfall(a: GroupBalance, b: GroupBalance) {
  return b.plannedSets - b.doneSets - (a.plannedSets - a.doneSets)
}

/**
 * Weekly volume per muscle group against what the program planned — the
 * hypertrophy anchor, and the one read pairing that already existed on both
 * sides without anyone ever putting them beside each other.
 *
 * Silent without an active program: there is no plan to be measured against.
 */
export async function MuscleBalance({
  userId,
  shape,
}: {
  userId: string
  shape: HomeSectionShape
}) {
  const t = await getTranslations('MuscleBalance')
  const [performed, planned] = await Promise.all([
    getRollingMuscleVolume(userId),
    getPlannedWeeklyVolume(userId),
  ])
  if (planned === null) return null
  const balance = aggregateVolumeBalance(performed.groups, planned.groups)
  if (balance === null) return null

  const rows = [...balance.groups].sort(byShortfall).slice(0, MAX_ROWS)

  return (
    <Link href="/stats" className="flex h-full flex-col transition-colors active:bg-muted/60">
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-display text-[0.66rem] font-medium uppercase leading-none tracking-[0.15em] text-muted-foreground">
          {t('title')}
        </span>
        <span className="shrink-0 text-[0.6rem] uppercase tracking-[0.08em] text-muted-foreground">
          {t('more')}
        </span>
      </span>

      <span className="mt-2 flex flex-col">
        <span className="flex items-baseline gap-1">
          <span className="font-display text-[2.6rem] font-semibold leading-[0.82] tnum">
            {Math.round(balance.doneSets)}
          </span>
          <span className="text-[0.68rem] font-medium text-muted-foreground">
            {t('ofPlanned', { total: Math.round(balance.plannedSets) })}
          </span>
        </span>
        {balance.lagging !== null && (
          <span className="mt-1.5 block text-[0.7rem] text-destructive-ink tnum">
            {t('behind', {
              group: balance.lagging.group,
              count: Math.round(balance.lagging.plannedSets - balance.lagging.doneSets),
            })}
          </span>
        )}
      </span>

      {shape !== 'wide' && shape !== 'micro' && (
        <span className="mt-auto flex flex-col gap-2 pt-3">
          {rows.map((g) => (
            <span key={g.group} className="grid grid-cols-[3rem_1fr_2.4rem] items-center gap-2">
              <span className="truncate text-[0.65rem] text-muted-foreground">{g.group}</span>
              <span className="block h-[3px] rounded-full bg-white/10">
                <span
                  className={
                    g.percent >= 90
                      ? 'block h-full rounded-full bg-primary'
                      : g.percent >= 60
                        ? 'block h-full rounded-full bg-muted-foreground'
                        : 'block h-full rounded-full bg-destructive-ink'
                  }
                  // Capped for DRAWING only — a 300% bar would run off the
                  // cell. The number beside it stays uncapped and honest.
                  style={{ width: `${Math.min(g.percent, 100)}%` }}
                />
              </span>
              <span className="text-right text-[0.65rem] text-muted-foreground tnum">
                {Math.round(g.doneSets)}/{Math.round(g.plannedSets)}
              </span>
            </span>
          ))}
        </span>
      )}
    </Link>
  )
}
