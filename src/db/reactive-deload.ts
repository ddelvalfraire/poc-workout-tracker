import { and, eq, gte, isNotNull } from 'drizzle-orm'
import { resolveDeloadPolicy } from '@/lib/progression'
import { getRedis } from '@/lib/redis'
import {
  REACTIVE_DELOAD_SOURCE,
  REACTIVE_DEFAULT_SHAPE,
  hasPendingReactiveDeloadProposal,
  reactiveDeloadKind,
  reactiveDeloadProposalContent,
  reactiveDeloadSubject,
  type ReactiveDeloadCandidate,
} from '@/lib/reactive-deload'
import {
  EFFORT_STEP_SOURCE,
  effortStepProposalContent,
  hasPendingEffortStepProposal,
} from '@/lib/effort-step'
import { db } from './index'
import { createPatchProposal, listPatchProposals } from './patch-proposals'
import { getProgramDetail, nextProgramWeek } from './programs'
import { deriveDayPrescription } from './prescriptions'
import { getWeightUnit } from './preferences'
import { programs, programDays, workouts } from './schema'

/**
 * Derive-time trigger for REACTIVE DELOAD proposals (the deferred half of
 * deloadPolicy mode 'reactive', #176) — the volume-progression precedent
 * applied to stalls: cheap gates first, the Redis marker before any heavy
 * read, then ONE derivation per day feeding proposal creation. Best-effort
 * by design: any failure logs and leaves the page unharmed, the marker stays
 * unset so the next load retries, and duplicates remain impossible either
 * way (the pending-source partial unique index owns dedup; the app-level
 * pending check just keeps the common path quiet).
 *
 * Cheap-skip discipline: nothing beyond one program-row read happens unless
 * the program is ACTIVE, autoregulation is ON, and either the resolved
 * deload policy is mode 'reactive' (Part B) or the diet phase is 'cutting'
 * (Part A's held H2 backoff — the hold gates auto-application in ANY policy
 * mode, so its confirmable proposal must fire in any mode too).
 */

/** Redis marker — a COST cap only (one real evaluation per program/week;
 *  a declined proposal isn't re-raised within its week). Correctness never
 *  depends on it: the partial unique index is the guarantee. */
const markerKey = (programId: string, week: number) => `reactive-deload:${programId}:w${week}`
const MARKER_TTL_SECONDS = 60 * 60 * 24 * 90

export async function ensureReactiveDeloadProposals(
  userId: string,
  programId: string,
): Promise<void> {
  try {
    const [program] = await db
      .select({
        id: programs.id,
        status: programs.status,
        autoregulation: programs.autoregulation,
        mesocycleWeeks: programs.mesocycleWeeks,
        deloadWeek: programs.deloadWeek,
        deloadPolicy: programs.deloadPolicy,
        dietPhase: programs.dietPhase,
      })
      .from(programs)
      .where(and(eq(programs.id, programId), eq(programs.userId, userId)))
      .limit(1)
    if (!program || program.status !== 'active' || !program.autoregulation) return
    const resolved = resolveDeloadPolicy(program.deloadPolicy, program.deloadWeek)
    const cutting = program.dietPhase === 'cutting'
    // Deload-flavored proposals: mode 'none' opted out entirely (#197);
    // otherwise 'reactive' (Part B) or a cutting hold (Part A) wants them.
    // EFFORT-STEP proposals (RPE plan slice 4) are not deloads — a step-up
    // ask fires under ANY policy, so the sweep now runs for every active
    // autoregulated program (the weekly marker still caps the cost).
    const wantsDeload = resolved.mode !== 'none' && (resolved.mode === 'reactive' || cutting)

    const currentWeek = await nextProgramWeek(userId, programId, program.mesocycleWeeks)
    const redis = getRedis()
    if (redis && (await redis.get(markerKey(programId, currentWeek))) !== null) return

    const detail = await getProgramDetail(userId, programId)
    if (!detail) return

    // Completed (day, week) pairs from the current week on — the per-day
    // "next untrained week" the overrides pin (a day already trained this
    // week deloads the FOLLOWING week, never a dead past week).
    const trainedRows = await db
      .select({ programDayId: workouts.programDayId, programWeek: workouts.programWeek })
      .from(workouts)
      .innerJoin(programDays, eq(programDays.id, workouts.programDayId))
      .where(
        and(
          eq(workouts.userId, userId),
          eq(programDays.programId, programId),
          isNotNull(workouts.completedAt),
          isNotNull(workouts.programWeek),
          gte(workouts.programWeek, currentWeek),
        ),
      )
    const trained = new Set(trainedRows.map((r) => `${r.programDayId}:${r.programWeek}`))

    const [pending, unit] = await Promise.all([
      listPatchProposals(userId, programId),
      getWeightUnit(userId),
    ])
    const shape = resolved.mode === 'scheduled' ? resolved.shape : REACTIVE_DEFAULT_SHAPE
    const proposedSubjects = new Set<string>()

    for (const day of detail.days) {
      // The day's next untrained week, clamped to the block. Past-the-block
      // days (block complete) raise nothing; under a 'scheduled' policy a
      // target landing ON the deload week is already backing off — silence.
      let targetWeek = currentWeek
      while (targetWeek <= program.mesocycleWeeks && trained.has(`${day.id}:${targetWeek}`)) {
        targetWeek += 1
      }
      if (targetWeek > program.mesocycleWeeks) continue
      if (resolved.mode === 'scheduled' && targetWeek === program.deloadWeek) continue

      const prescriptions = await deriveDayPrescription(
        userId,
        {
          exercises: day.exercises,
          program: {
            id: detail.id,
            mesocycleWeeks: detail.mesocycleWeeks,
            deloadWeek: detail.deloadWeek,
            autoregulation: detail.autoregulation,
            autoregStallPolicy: detail.autoregStallPolicy,
            deloadPolicy: detail.deloadPolicy,
            dietPhase: detail.dietPhase,
            overshootPolicy: detail.overshootPolicy,
          },
        },
        targetWeek,
      )

      for (const [index, exercise] of day.exercises.entries()) {
        const subject = reactiveDeloadSubject(exercise.source, exercise.wgerExerciseId)
        const workingSets = (prescriptions[index]?.sets ?? [])
          .filter((s) => s.setType === 'working')
          .map((s) => ({ setNumber: s.setNumber, loadKg: s.loadKg }))

        const adjustment = prescriptions[index]?.autoreg ?? null
        const kind = wantsDeload
          ? reactiveDeloadKind(adjustment, resolved.mode, program.dietPhase)
          : null
        if (kind !== null && adjustment !== null) {
          // First occurrence wins (deriveDayPrescription already shares one
          // verdict per identity); pending rows block a re-ask outright.
          if (!proposedSubjects.has(subject) && !hasPendingReactiveDeloadProposal(pending, subject)) {
            const candidate: ReactiveDeloadCandidate = {
              name: exercise.name,
              dayPosition: day.position,
              exercisePosition: exercise.position,
              week: targetWeek,
              workingSets,
              adjustment,
            }
            const content = reactiveDeloadProposalContent(candidate, kind, shape, unit)
            if (content !== null) {
              proposedSubjects.add(subject)
              // A null result (concurrent duplicate, program drifted) is a
              // no-op — the ON CONFLICT no-op inside createPatchProposal is
              // the race net.
              await createPatchProposal(
                userId,
                programId,
                { ...content, source: REACTIVE_DELOAD_SOURCE, muscleGroup: subject },
                'mcp',
              )
            }
          }
        }

        // Effort-step (slice 4): sustained undershoot earns a step-UP ask —
        // the mirror proposal, own source, own pending row. A lift never
        // gets both asks in one sweep: a deload-flavored verdict wins (the
        // signals are contradictory; stall evidence outranks easy evidence).
        const stepLoadKg = prescriptions[index]?.effortStepLoadKg ?? null
        if (stepLoadKg === null || kind !== null) continue
        if (proposedSubjects.has(subject)) continue
        if (hasPendingEffortStepProposal(pending, subject)) continue
        const stepContent = effortStepProposalContent(
          {
            name: exercise.name,
            dayPosition: day.position,
            exercisePosition: exercise.position,
            week: targetWeek,
            workingSets,
          },
          stepLoadKg,
          unit,
        )
        if (stepContent === null) continue
        proposedSubjects.add(subject)
        await createPatchProposal(
          userId,
          programId,
          { ...stepContent, source: EFFORT_STEP_SOURCE, muscleGroup: subject },
          'mcp',
        )
      }
    }

    if (redis) {
      await redis.set(markerKey(programId, currentWeek), '1', { ex: MARKER_TTL_SECONDS })
    }
  } catch (error: unknown) {
    // Enhancement on a read path: never break the page; next load retries.
    console.error('reactive deload proposal check failed (page unaffected)', error)
  }
}
