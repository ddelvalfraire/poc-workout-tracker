import { requireUserId } from '@/lib/auth'
import { listWorkoutSummaries } from '@/db/workouts'
import { listWorkoutDrafts } from '@/db/workout-drafts'
import { getWeightUnit } from '@/db/preferences'
import { resolveActiveSession } from '@/lib/active-session'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { HistoryList } from '../history-list'

/**
 * /history — the full training log, moved off home (WHOOP tier discipline:
 * tier-3 data leaves tier-1 real estate; home keeps the last 5). Same rows,
 * same calendar anchors, same guarded Repeat — which is why the drafts read
 * comes along: Repeat is a start CTA and must respect the single-active-
 * session rule here too. Sub-page chrome: back chevron, no drawer trigger.
 */
export default async function HistoryPage() {
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

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="History"
        leading={
          <BackLink fallback="/" />
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe pt-6">
        {completed.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-12 text-center">
            <p className="font-medium">No workouts yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Finished sessions land here — your full training log.
            </p>
          </div>
        ) : (
          <HistoryList workouts={completed} unit={unit} guardSession={guardSession} />
        )}
      </main>
    </div>
  )
}
