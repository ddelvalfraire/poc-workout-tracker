'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button, buttonVariants } from '@/components/ui/button'
import { getExerciseSheetAction } from '@/app/workout/actions'
import { exerciseHref } from '@/app/exercises/exercise-ref'
import { formatLoggedSet, formatVolume, formatWorkoutDate } from '@/lib/format'
import { sessionBestSet } from '@/lib/session-best-set'
import { kgToDisplay, type WeightUnit } from '@/lib/units'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { cn } from '@/lib/utils'

/**
 * Bottom sheet for an exercise's all-time story mid-session: records, the
 * last few sessions, and a link out to the full stats page. Opened by tapping
 * the exercise's NAME in the logger — the PRD's zero-new-chrome entry point.
 * The dialog mechanics (showModal, StrictMode guard, geometric backdrop
 * dismiss, scroll lock, close() in cleanup) are copied from plate-sheet.tsx
 * verbatim: three sheets, one behavior.
 *
 * Read-only: nothing here touches the draft, so the button never freezes
 * behind the save/discard barriers the way replace does.
 */

interface StatsSheetProps {
  wgerExerciseId: number
  /** Composite-identity half: a custom exercise's id can equal a wger id. */
  source: ExerciseSource
  /** Display name from the draft — the sheet's title while data loads. */
  name: string
  unit: WeightUnit
  onClose: () => void
}

export function StatsSheet({ wgerExerciseId, source, name, unit, onClose }: StatsSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  // Carried as ?from= so the full-stats page's back arrow returns HERE (the
  // live session), not to the exercises list it assumes by default.
  const pathname = usePathname()

  // Cached per exercise: reopening mid-session is instant. Records changing
  // DURING the session (a PR being set) is Phase 4's concern, not the sheet's.
  const { data, isPending, isError } = useQuery({
    queryKey: ['exercise-sheet', source, wgerExerciseId],
    queryFn: () => getExerciseSheetAction(wgerExerciseId, source),
    staleTime: 60_000,
  })

  // Native <dialog> + showModal(): the browser owns the focus trap AND makes
  // the page behind genuinely inert. Manual body scroll lock, initial focus
  // on the visible ×, focus restore on unmount — the shared sheet recipe.
  useEffect(() => {
    const dialog = dialogRef.current
    const active = document.activeElement
    const previouslyFocused =
      active instanceof HTMLElement && !dialog?.contains(active) ? active : null
    // StrictMode re-runs effects against the SAME node; showModal() on an
    // already-open dialog throws InvalidStateError.
    if (dialog && !dialog.open) dialog.showModal()
    closeButtonRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      // Explicitly release the top layer: unmounting a modal dialog without
      // close() can strand its ::backdrop over the incoming page when the
      // unmount happens mid-navigation (the View-full-stats link does exactly
      // that), eating every tap afterwards.
      if (dialog?.open) dialog.close()
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  const records = data?.stats.records

  return (
    <dialog
      ref={dialogRef}
      aria-label={`Stats for ${name}`}
      onCancel={(e) => {
        e.preventDefault() // keep open/closed state owned by React
        onClose()
      }}
      onClick={(e) => {
        // Geometric backdrop test, NOT `target === dialog`: taps in the
        // sheet's own padding and inter-section margin gaps also target the
        // dialog element and must not dismiss it.
        const rect = dialogRef.current?.getBoundingClientRect()
        if (!rect) return
        const inside =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        if (!inside) onClose()
      }}
      className="mx-auto mt-auto mb-0 max-h-[85dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl border-t border-x border-border bg-card px-5 pt-5 pb-safe text-foreground backdrop:bg-black/60 motion-safe:animate-sheet-up"
    >
      <div className="flex items-start justify-between gap-3 pb-1">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            All-time stats
          </p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{name}</p>
        </div>
        <Button
          ref={closeButtonRef}
          size="icon-sm"
          variant="ghost"
          className="-mr-1 text-muted-foreground"
          onClick={onClose}
          aria-label="Close"
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>

      {isPending && (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading stats…</p>
      )}

      {isError && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Couldn&apos;t load stats. Close and reopen to retry.
        </p>
      )}

      {!isPending && !isError && data === null && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No completed sessions yet — finish a workout with this movement and its records land
          here.
        </p>
      )}

      {data && records && (
        <>
          {/* The headline record leads as a poster moment (font-display,
              proportional figures — tnum is for columns, not display type);
              the remaining records compress into a 3-up glance row. */}
          {records.bestE1rm ? (
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Best est. 1RM
              </p>
              <p className="mt-1 font-display text-5xl leading-none tracking-tight">
                {kgToDisplay(records.bestE1rm.e1rm, unit)}
                <span className="ml-1.5 text-lg text-muted-foreground">{unit}</span>
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground tnum">
                {kgToDisplay(records.bestE1rm.weightKg, unit)} {unit} × {records.bestE1rm.reps} ·{' '}
                {formatWorkoutDate(records.bestE1rm.performedAt)}
              </p>
            </div>
          ) : (
            !records.heaviestLoadKg &&
            !records.mostReps && (
              <p className="mt-2 text-sm text-muted-foreground">
                No load records yet — log weight and PRs land here.
              </p>
            )
          )}

          {(records.heaviestLoadKg || records.mostReps || records.bestSessionVolumeKg) && (
            <dl className="mt-4 grid grid-cols-3 gap-2">
              {records.heaviestLoadKg && (
                <div className="rounded-xl border border-border px-2.5 py-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Heaviest
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tnum">
                    {kgToDisplay(records.heaviestLoadKg.weightKg, unit)} {unit}
                    <span className="ml-1 font-normal text-muted-foreground">
                      ×{records.heaviestLoadKg.reps}
                    </span>
                  </dd>
                </div>
              )}
              {records.mostReps && (
                <div className="rounded-xl border border-border px-2.5 py-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Most reps
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tnum">{records.mostReps.reps}</dd>
                </div>
              )}
              {records.bestSessionVolumeKg && (
                <div className="rounded-xl border border-border px-2.5 py-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Top volume
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tnum">
                    {formatVolume(records.bestSessionVolumeKg.volumeKg, unit)}
                  </dd>
                </div>
              )}
            </dl>
          )}

          {/* Recent sessions — completed sets only, one line each; the
              session's best set (same picker as the stats page) reads bold so
              the line scans instead of blurring. */}
          {data.recent.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Recent
              </p>
              <ul className="mt-2 space-y-2">
                {data.recent.map((session) => {
                  const best = sessionBestSet(session.sets, data.stats.exercise.loggingType)
                  const shown = session.sets
                    .map((set, index) => ({ set, index }))
                    .filter(({ set }) => set.completed)
                  return (
                    <li
                      key={session.workoutId}
                      className="flex items-baseline gap-3 text-sm"
                    >
                      <span className="w-24 shrink-0 text-xs text-muted-foreground">
                        {formatWorkoutDate(session.performedAt)}
                      </span>
                      <span className="min-w-0 tnum">
                        {shown.length === 0
                          ? '—'
                          : shown.map(({ set, index }, position) => (
                              <span key={index}>
                                {position > 0 && ', '}
                                <span
                                  className={cn(index === best?.index && 'font-semibold')}
                                >
                                  {formatLoggedSet(set, unit, data.stats.exercise.loggingType)}
                                </span>
                              </span>
                            ))}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="mt-5 pb-4">
        <Link
          href={`${exerciseHref({ source, wgerExerciseId })}?from=${encodeURIComponent(pathname)}`}
          className={cn(buttonVariants({ variant: 'outline' }), 'w-full font-semibold uppercase')}
        >
          View full stats
        </Link>
      </div>
    </dialog>
  )
}
