import { requireUserId } from '@/lib/auth'
import { listWorkoutSummaries } from '@/db/workouts'
import { listWorkoutDrafts } from '@/db/workout-drafts'
import { getWeightUnit } from '@/db/preferences'
import { resolveActiveSession } from '@/lib/active-session'
import { formatVolume } from '@/lib/format'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { GuardedStartLink } from '@/components/guarded-start-link'
import { buttonVariants } from '@/components/ui/button'
import { EmptyWords } from '@/components/ui/empty-words'
import { HistoryList } from './history-list'
import { historyStatusLine, monthBuckets } from './history-view'
import { getTranslations } from 'next-intl/server'

/**
 * /history — the full training log, moved off home (WHOOP tier discipline:
 * tier-3 data leaves tier-1 real estate; home keeps the last 5). Same rows,
 * same calendar anchors, same guarded Repeat — which is why the drafts read
 * comes along: Repeat is a start CTA and must respect the single-active-
 * session rule here too. Sub-page chrome: back chevron, no drawer trigger.
 *
 * The log reads as chapters, not a scroll of rows: an editorial status line
 * up top, then sticky month headers with rollups over the shared HistoryList
 * (one list per month — home's compact reuse stays header-free by design;
 * see history-list.tsx). All derivation is over the one summaries array
 * already in memory.
 */
export default async function HistoryPage() {
  const t = await getTranslations('History')
  const userId = await requireUserId()
  const [summaries, unit, drafts] = await Promise.all([
    listWorkoutSummaries(userId),
    getWeightUnit(userId),
    listWorkoutDrafts(userId),
  ])
  const activeSession = resolveActiveSession(drafts, summaries, new Date())
  const guardSession = activeSession && {
    key: activeSession.key,
    name: activeSession.name,
    setCount: activeSession.setCount,
    completedSetCount: activeSession.completedSetCount,
  }
  const completed = summaries.filter((w) => w.completedAt !== null)
  const now = new Date()
  const statusLine = historyStatusLine(completed, now)
  const buckets = monthBuckets(completed, now)
  // Row emphasis normalizes to the WHOLE list's max, not per month — a small
  // month must not inflate its sessions.
  const maxVolumeKg = completed.reduce((max, w) => Math.max(max, w.volumeKg), 0)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={t('title')}
        leading={
          <BackLink fallback="/" />
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe pt-6">
        {completed.length === 0 ? (
          <>
            <EmptyWords>
              {t('empty')}
            </EmptyWords>
            {/* The empty state is an invitation, not a dead end. Guarded like
                every other start CTA (single-active-session rule). */}
            <div className="text-center">
              <GuardedStartLink
                href="/workout/new"
                session={guardSession}
                className={buttonVariants({ className: 'mt-2' })}
              >
                {t('startAction')}
              </GuardedStartLink>
            </div>
          </>
        ) : (
          <>
            {statusLine !== null && (
              <p className="mb-4 px-1 text-sm text-muted-foreground tnum">{statusLine}</p>
            )}
            <div className="space-y-6">
              {buckets.map((bucket) => (
                <section key={bucket.key} aria-label={bucket.label}>
                  {/* Sticky under the h-14 app header (plus the safe-area it
                      pads); backdrop matches the header so rows scroll under
                      it cleanly. */}
                  <h2 className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-[5] -mx-1 flex items-baseline gap-2 bg-background/90 px-1 py-2 backdrop-blur-md">
                    <span className="font-display text-xl uppercase leading-none tracking-wide">
                      {bucket.label}
                    </span>
                    <span className="text-sm text-muted-foreground tnum">
                      {t('bucketSessions', { count: bucket.sessions })}
                      {bucket.volumeKg > 0 && <> · {formatVolume(bucket.volumeKg, unit)}</>}
                    </span>
                  </h2>
                  <div className="mt-1">
                    <HistoryList
                      workouts={bucket.workouts}
                      unit={unit}
                      guardSession={guardSession}
                      maxVolumeKg={maxVolumeKg}
                    />
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
