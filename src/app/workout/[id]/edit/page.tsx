import { notFound } from 'next/navigation'
import { requireUserId } from '@/lib/auth'
import { getWorkoutDetail, type WorkoutDetail } from '@/db/workouts'
import { getWeightUnit, getEquipment, getDefaultRestSec, getRestTimerEnabled } from '@/db/preferences'
import { getProgramDayDetail, deriveDayPrescription } from '@/db/programs'
import { getWorkoutDraft } from '@/db/workout-drafts'
import type { PlanSetTarget } from '@/lib/format'
import type { WeightUnit } from '@/lib/units'
import { autoregReason } from '@/lib/autoregulate'
import { detailToDraft } from '@/app/workout/new/workout-draft'
import { WorkoutLogger } from '@/app/workout/new/workout-logger'
import { resolveDraftSeed } from '@/app/workout/new/draft-payload'

/**
 * Per-exercise plan targets (keyed by the composite `source:wgerExerciseId`)
 * for a program-instantiated workout — the ghost-placeholder fallback when an exercise has no prior
 * history. Derives the same week-N prescription instantiation seeded from, so
 * the ghosts match what the program page promised. Returns undefined for
 * ad-hoc workouts and when provenance is gone (day deleted/replaced — the
 * SET NULL caveat), so the logger falls back to history-only ghosts.
 * First slot wins if a day repeats an exercise.
 */
async function loadPlanTargets(
  userId: string,
  workout: WorkoutDetail,
  unit: WeightUnit,
): Promise<
  | {
      targets: Record<string, PlanSetTarget[]>
      supersets: Record<string, number>
      dayName: string
      autoreg: Record<string, { reason: string; suggestEarlyDeload: boolean }>
    }
  | undefined
> {
  if (!workout.programDayId || !workout.programWeek) return undefined
  const day = await getProgramDayDetail(userId, workout.programDayId)
  if (!day) return undefined

  // This workout is excluded from its own autoreg history — a half-logged
  // session must never testify to its own stall.
  const derived = await deriveDayPrescription(userId, day, workout.programWeek, {
    excludeWorkoutId: workout.id,
  })
  const targets: Record<string, PlanSetTarget[]> = {}
  // Per-exercise Layer 1 reasons (display unit applied here, not in the db
  // layer), same first-slot-wins keying as the targets.
  const autoreg: Record<string, { reason: string; suggestEarlyDeload: boolean }> = {}
  // Plan-declared superset pairings (display-only in the logger): same
  // first-slot-wins keying as the targets so the two maps stay congruent.
  const supersets: Record<string, number> = {}
  day.exercises.forEach((exercise, i) => {
    const key = `${exercise.source}:${exercise.wgerExerciseId}`
    if (key in targets) {
      // A repeated exercise whose LATER slot carries a different grouping is
      // ambiguous under identity keying — drop the pairing entirely rather
      // than paint one slot's group onto both cards.
      if ((supersets[key] ?? null) !== exercise.supersetGroup) delete supersets[key]
      return
    }
    if (exercise.supersetGroup !== null) supersets[key] = exercise.supersetGroup
    const adjustment = derived[i].autoreg
    if (adjustment) {
      autoreg[key] = {
        reason: autoregReason(adjustment, unit),
        suggestEarlyDeload: adjustment.suggestEarlyDeload,
      }
    }
    targets[key] = derived[i].sets.map((s) => ({
      repMin: s.repMin,
      repMax: s.repMax,
      loadKg: s.loadKg,
      // The unadjusted scheme value, only where autoreg won — the logger's
      // "Use plan as written" escape reverts THIS exercise's ghosts to it.
      ...(s.derivedFrom === 'autoreg' && s.schemeLoadKg !== undefined
        ? { planLoadKg: s.schemeLoadKg }
        : {}),
      // Per-set rest prescription — drives the logger's rest countdown
      // (override > template, via the same derivation as the load ghosts).
      restSec: s.restSec,
    }))
  })
  // The day name rides along so the logger can say which (day, week) this
  // session is stamped to — provenance is fixed at start, so it must be
  // VISIBLE before 20 sets land in the wrong day.
  return { targets, supersets, dayName: day.name, autoreg }
}

export default async function EditWorkoutPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const userId = await requireUserId()
  const { id } = await params
  const [workout, unit] = await Promise.all([
    getWorkoutDetail(userId, id),
    getWeightUnit(userId),
  ])
  if (!workout) notFound()

  const [plan, equipment, defaultRestSec, restTimerEnabled, draftRow] = await Promise.all([
    loadPlanTargets(userId, workout, unit),
    getEquipment(userId, unit),
    getDefaultRestSec(userId),
    getRestTimerEnabled(userId),
    // The logger's autosave key for this surface is the workout id; the write
    // path lower-cases keys at the action boundary, so read the same form.
    getWorkoutDraft(userId, id.toLowerCase()),
  ])
  // Server-side draft seeding: a live draft is newer than the workout rows it
  // was seeded from, so it wins over detailToDraft — resolved HERE to kill the
  // mount-time content swap (rows render, then the restore effect swaps in the
  // draft). Shared TTL+codec helper; the client restore effect stays as the
  // cross-device race net.
  const restored = resolveDraftSeed(draftRow, { unit, now: new Date() })
  const { draft, name } = restored ?? detailToDraft(workout, unit)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {/* The logger renders the app bar itself (the session clock lives in
          it); this page only decides the words and the exit. Header action
          says "Close", not "Cancel": the autosaved draft survives and
          resumes from the home banner — nothing is cancelled. Where Close
          lands depends on what this session IS: editing a finished workout
          came from its summary, so Close returns there; a live (unfinished)
          session goes home, where the in-progress banner owns it — its
          read-only summary would present it as completed. isLive follows the
          same split: an unfinished workout is a session being logged now
          (volt Finish), a finished one is a correction (Save changes). */}
      <WorkoutLogger
        workoutId={id}
        isLive={workout.completedAt === null}
        title={workout.completedAt === null ? 'Log Workout' : 'Edit Workout'}
        closeHref={workout.completedAt === null ? '/' : `/workout/${id}`}
        initialDraft={draft}
        initialName={name}
        unit={unit}
        planTargets={plan?.targets}
        planSupersets={plan?.supersets}
        planAutoreg={plan?.autoreg}
        // Which (day, week) this session is stamped to — provenance is fixed
        // at start, so the logger surfaces it instead of hiding it.
        programContext={
          plan && workout.programWeek !== null
            ? `${plan.dayName} · Week ${workout.programWeek}`
            : undefined
        }
        // When the draft seeds the session, its openedAt must also seed the
        // clock — the draft can predate the row's startedAt semantics (a
        // restored snapshot rewinds to the original session start).
        startedAt={restored?.openedAt ?? workout.startedAt}
        equipment={equipment}
        defaultRestSec={defaultRestSec}
        restTimerEnabled={restTimerEnabled}
      />
    </div>
  )
}
