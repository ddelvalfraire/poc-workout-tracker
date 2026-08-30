import { adoptTemplate } from '@/db/templates'
import { setProgramStatus, getProgramDetail, listPrograms } from '@/db/programs'
import { instantiateProgramDay } from '@/db/prescriptions'
import { getWorkoutDetail, updateWorkout } from '@/db/workouts'
import { TEMPLATE_OWNER_USER_ID } from '@/lib/template-owner'
import { consentAll, setUnit } from '../actions'
import type { PersonaDefinition } from './types'

/** Fixed, documented default — the same GZCLP fixture proposed as the
 *  `veteran` persona's default (PRD D-1), reused here for consistency.
 *  Not configurable in Phase 1 (YAGNI). */
const DEFAULT_TEMPLATE_NAME = 'GZCLP'

/** A week-one user: adopted a library template, played its first two days,
 *  both backdated to the same instant 5 days before the run's anchor. */
export const weekOne: PersonaDefinition = {
  slug: 'week-one',
  async run({ userId, clock }) {
    await consentAll(userId)
    await setUnit(userId, 'kg')

    const templates = await listPrograms(TEMPLATE_OWNER_USER_ID)
    const template = templates.find((t) => t.name === DEFAULT_TEMPLATE_NAME)
    if (!template) {
      throw new Error(
        `template "${DEFAULT_TEMPLATE_NAME}" not found under the system account — ` +
          'run `npm run db:seed-templates` against this database first',
      )
    }

    const adopted = await adoptTemplate(userId, template.id)
    if (!adopted) throw new Error('adoptTemplate refused — check adopt gating in src/db/templates.ts')
    await setProgramStatus(userId, adopted.id, 'active', 'seed')

    const detail = await getProgramDetail(userId, adopted.id)
    if (!detail) throw new Error(`getProgramDetail returned nothing for the just-adopted program ${adopted.id}`)
    const daysToPlay = detail.days.slice(0, 2)
    const backdated = clock.daysAgo(5)
    let workoutId = ''

    for (const day of daysToPlay) {
      const instantiated = await instantiateProgramDay(userId, day.id, 1, 'seed')
      if (!instantiated) throw new Error(`instantiateProgramDay returned null for day ${day.id}`)
      const prescribed = await getWorkoutDetail(userId, instantiated.id)
      if (!prescribed) throw new Error(`getWorkoutDetail returned nothing for workout ${instantiated.id}`)
      await updateWorkout(
        userId,
        instantiated.id,
        {
          exercises: prescribed.exercises.map((ex) => ({
            wgerExerciseId: ex.wgerExerciseId,
            source: ex.source,
            name: ex.name,
            sets: ex.sets.map((s) => ({ reps: s.reps, weight: s.weight, completed: true })),
          })),
          startedAt: backdated,
          completedAt: backdated,
        },
        { actor: 'seed', kind: 'original' },
      )
      workoutId = instantiated.id
    }

    return { programId: adopted.id, templateId: template.id, workoutId }
  },
}
