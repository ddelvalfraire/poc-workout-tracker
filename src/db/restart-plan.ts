import { getProgramDetail, programWeekState } from './programs'
import { deriveDayPrescription } from './prescriptions'
import {
  collectTmRestartFlags,
  collectTmIncrements,
  type TmRestartFlag,
  type TmIncrement,
} from '@/lib/programs/tm-restart'

/**
 * Block-restart TM carry-forward — the io half (pure collectors live in
 * lib/tm-restart.ts). Derives the CURRENT week's prescriptions for EVERY day
 * of the program (unlike the program page, which honestly skips collapsed
 * days) so a restart's M4 skip list can never miss a flagged lift on a day
 * the owner never expanded. Restart is rare; the extra history reads are the
 * price of a correct plan. Returns null when the program isn't owned.
 */
export interface RestartTmPlan {
  flags: TmRestartFlag[]
  increments: TmIncrement[]
}

export async function restartTmPlan(
  userId: string,
  programId: string,
): Promise<RestartTmPlan | null> {
  const program = await getProgramDetail(userId, programId)
  if (!program) return null
  const { currentWeek } = await programWeekState(userId, program.id, program.mesocycleWeeks)
  const prescriptions = await Promise.all(
    program.days.map((day) =>
      deriveDayPrescription(
        userId,
        {
          exercises: day.exercises,
          program: {
            id: program.id,
            mesocycleWeeks: program.mesocycleWeeks,
            deloadWeek: program.deloadWeek,
            autoregulation: program.autoregulation,
            autoregStallPolicy: program.autoregStallPolicy,
            deloadPolicy: program.deloadPolicy,
            dietPhase: program.dietPhase,
            overshootPolicy: program.overshootPolicy,
          },
        },
        currentWeek,
      ),
    ),
  )
  const flags = collectTmRestartFlags(program.days, prescriptions)
  return { flags, increments: collectTmIncrements(program.days, flags) }
}
