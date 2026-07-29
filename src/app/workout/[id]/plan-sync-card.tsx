'use client'

import { useState } from 'react'
import type { PlanSyncCandidate } from '@/lib/plan-sync'
import { kgToDisplay, type WeightUnit } from '@/lib/units'
import { Button } from '@/components/ui/button'
import { syncPlanToPerformanceAction } from '@/app/workout/actions'

/**
 * The plan-sync confirm card: this session beat the plan's loads, so offer —
 * never silently apply — to make the performed loads the plan's new baseline
 * (the forced-confirm rule from the proposals PRD: plan mutations from
 * performance are user-confirmed). The server action recomputes the
 * candidates; this card's numbers are display only.
 *
 * Volt stays a marker here (kicker + border tint), not the button: the page's
 * one volt CTA is Repeat workout in WorkoutActions, and this card follows the
 * same outline-button discipline as FinishUpNextCard. Dismiss is client-side
 * only — no persistence, the offer may return on the next visit.
 */
export function PlanSyncCard({
  workoutId,
  unit,
  candidates,
}: {
  workoutId: string
  unit: WeightUnit
  candidates: PlanSyncCandidate[]
}) {
  const [isPending, setIsPending] = useState(false)
  const [isDone, setIsDone] = useState(false)
  const [isHidden, setIsHidden] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (isHidden) return null

  async function handleSync() {
    setIsPending(true)
    setError(null)
    try {
      await syncPlanToPerformanceAction(workoutId)
      setIsDone(true)
    } catch {
      setError('Could not update the plan. Please try again.')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <section
      aria-label="Update plan to match performance"
      className="mt-4 rounded-2xl border border-primary/50 bg-card p-5 motion-safe:animate-rise-in"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">
        Beyond the plan
      </p>
      <h2 className="mt-2 font-display text-3xl uppercase leading-none tracking-wide">
        Update your plan?
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        You lifted heavier than the plan calls for. Make it the new baseline?
      </p>

      <div className="mt-3 space-y-2">
        {candidates.map((candidate) => {
          // One line per exercise, spoken from its heaviest changed set (the
          // engine's evidence convention — same pick as the change-log line).
          const top = candidate.changes.reduce((a, b) =>
            (b.currentLoadKg ?? -1) > (a.currentLoadKg ?? -1) ? b : a,
          )
          return (
            <div
              key={candidate.exercisePosition}
              className="flex items-baseline justify-between gap-3"
            >
              <span className="min-w-0 truncate text-sm font-medium">{candidate.name}</span>
              <span className="shrink-0 tnum text-sm text-muted-foreground">
                Plan {top.currentLoadKg === null ? '—' : kgToDisplay(top.currentLoadKg, unit)}
                {' → '}
                <span className="font-semibold text-foreground">
                  {kgToDisplay(top.proposedLoadKg, unit)} {unit}
                </span>
              </span>
            </div>
          )
        })}
      </div>

      {isDone ? (
        <p className="mt-4 text-sm font-medium text-primary">
          Plan updated — next session starts from these loads.
        </p>
      ) : (
        <div className="mt-4 flex items-center gap-2">
          <Button variant="outline" className="flex-1" disabled={isPending} onClick={handleSync}>
            {isPending ? 'Updating plan…' : 'Update plan to match'}
          </Button>
          <Button
            variant="ghost"
            className="shrink-0 text-muted-foreground"
            disabled={isPending}
            onClick={() => setIsHidden(true)}
          >
            Not now
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  )
}
