import { describe, it, expect } from 'vitest'
import { parseProgramInput, type ProgramInput } from '../program-input'
import { TEMPLATE_CANON, WGER } from './index'
import { STRENGTH_CANON } from './strength'
import { HYPERTROPHY_CANON } from './hypertrophy'
import { CONDITIONING_CANON } from './conditioning'

/**
 * Seed-payload validation: every canonical template must clear the SAME
 * boundary the seed script writes through (`parseProgramInput`), and the
 * scheme configs the corpus certifies ([W1]/[G1]/[S1] —
 * lib/testing/corpus.test.ts) must be present byte-for-byte. This is the
 * no-DB stand-in for running the seed: if these pass, the script's
 * `saveProgram` inputs are valid by construction.
 */

/** Parse once — a throw here IS the failure the suite exists to catch. */
const parsed: ProgramInput[] = TEMPLATE_CANON.map((t) => parseProgramInput(t))
const byName = new Map(parsed.map((p) => [p.name, p]))

function get(name: string): ProgramInput {
  const program = byName.get(name)
  if (!program) throw new Error(`template missing: ${name}`)
  return program
}

const CANON_NAMES = [
  'Arnold Split',
  'Body Part Split',
  'Candito 6-Week Strength',
  'Couch to 5K',
  'Dumbbell Only',
  'Full Body Hypertrophy',
  'GZCLP',
  'Greyskull LP',
  'Hybrid Strength & Endurance',
  'Kettlebell Simple & Sinister',
  'Madcow 5×5',
  'PHAT',
  'PHUL',
  'Push Pull Legs',
  'Recommended Routine',
  'Smolov Jr',
  'Starting Strength',
  'StrongLifts 5×5',
  'Texas Method',
  'Upper / Lower',
  'Wendler 5/3/1',
  'nSuns 5/3/1 LP',
]

describe('template canon — the library as a whole', () => {
  it('ships every planned template under a unique name', () => {
    expect(parsed).toHaveLength(CANON_NAMES.length)
    expect(new Set(parsed.map((p) => p.name)).size).toBe(CANON_NAMES.length)
    expect([...byName.keys()].sort()).toEqual([...CANON_NAMES].sort())
  })

  it('is exactly the three families concatenated, nothing dropped or doubled', () => {
    const families = [...STRENGTH_CANON, ...HYPERTROPHY_CANON, ...CONDITIONING_CANON]
    expect(TEMPLATE_CANON).toHaveLength(families.length)
    expect(TEMPLATE_CANON.map((p) => p.name)).toEqual(families.map((p) => p.name))
  })

  it('every template is public, draft-status, iconed, and described', () => {
    for (const p of parsed) {
      expect(p.visibility).toBe('public')
      expect(p.status).toBe('draft')
      expect(p.icon).toBeTruthy()
      expect(p.description ?? '').not.toBe('')
      expect(p.sourceUrl ?? '').toMatch(/^https:/)
    }
  })

  it('references only wger ids from the verified catalog set', () => {
    const verified = new Set<number>(Object.values(WGER))
    for (const p of parsed) {
      for (const day of p.days) {
        for (const exercise of day.exercises) {
          expect(exercise.source).toBe('wger') // the schema default materialized
          expect(verified.has(exercise.wgerExerciseId)).toBe(true)
        }
      }
    }
  })

  it('never puts a load-anchored scheme on a timed set', () => {
    // The derivation layer no-ops these (silence over corruption), so an
    // authoring slip would be invisible at runtime — catch it here instead.
    const loadAnchored = new Set(['linear', 'double-progression', 'percent-1rm', 'amrap-cycle'])
    for (const p of parsed) {
      for (const day of p.days) {
        for (const exercise of day.exercises) {
          const timed = exercise.sets.some((s) => s.metricMode !== 'reps_weight')
          if (!timed) continue
          expect(
            exercise.progression === null ||
              exercise.progression === undefined ||
              !loadAnchored.has(exercise.progression.scheme),
            `${p.name} / ${day.name} / ${exercise.name} rides a load scheme on a timed set`,
          ).toBe(true)
        }
      }
    }
  })

  it('gives every timed set a planned duration and every rep set a rep target', () => {
    for (const p of parsed) {
      for (const day of p.days) {
        for (const exercise of day.exercises) {
          for (const s of exercise.sets) {
            if (s.metricMode === 'reps_weight') expect(s.repMin).not.toBeNull()
            else expect(s.durationSec).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it('keeps every amrap-cycle ladder coherent: one rep row per wave row, one target per set', () => {
    for (const p of parsed) {
      for (const day of p.days) {
        for (const exercise of day.exercises) {
          const progression = exercise.progression
          if (progression?.scheme !== 'amrap-cycle') continue
          expect(progression.waveReps).toBeDefined()
          expect(progression.waveReps).toHaveLength(progression.wave.length)
          for (const [i, row] of progression.wave.entries()) {
            expect(row).toHaveLength(exercise.sets.length)
            expect(progression.waveReps?.[i]).toHaveLength(exercise.sets.length)
          }
          expect(progression.tmBumpTiming).toBe('after-deload')
        }
      }
    }
  })

  it('only schedules a deload week when the policy actually shapes one', () => {
    for (const p of parsed) {
      if (p.deloadWeek == null) continue
      expect(p.deloadWeek).toBeLessThanOrEqual(p.mesocycleWeeks)
      expect(p.deloadPolicy?.mode, `${p.name} schedules week ${p.deloadWeek}`).toBe('scheduled')
    }
  })

  it('pairs every superset group — a group of one is an authoring slip', () => {
    for (const p of parsed) {
      for (const day of p.days) {
        const groups = new Map<number, number>()
        for (const exercise of day.exercises) {
          if (exercise.supersetGroup == null) continue
          groups.set(exercise.supersetGroup, (groups.get(exercise.supersetGroup) ?? 0) + 1)
        }
        for (const [group, count] of groups) {
          expect(count, `${p.name} / ${day.name} group ${group}`).toBeGreaterThan(1)
        }
      }
    }
  })
})

describe('Wendler 5/3/1 [W1]', () => {
  const p = () => get('Wendler 5/3/1')

  it('is a 4-day, 4-week block with a scheduled week-4 deload and planSync OFF', () => {
    expect(p().days).toHaveLength(4)
    expect(p().mesocycleWeeks).toBe(4)
    expect(p().deloadWeek).toBe(4)
    expect(p().deloadPolicy).toMatchObject({ mode: 'scheduled' })
    // Deliberate percentages: the plan must not chase the log.
    expect(p().planSync).toBe(false)
  })

  it('every main lift carries the published wave, deload row, and after-deload TM bump', () => {
    for (const day of p().days) {
      const main = day.exercises[0]
      expect(main.progression).toMatchObject({
        scheme: 'amrap-cycle',
        wave: [
          [0.65, 0.75, 0.85],
          [0.7, 0.8, 0.9],
          [0.75, 0.85, 0.95],
        ],
        waveReps: [
          [5, 5, 5],
          [3, 3, 3],
          [5, 3, 1],
        ],
        deloadRow: { percents: [0.4, 0.5, 0.6], reps: 5 },
        tmBumpTiming: 'after-deload',
      })
      // The wave's last work set is the AMRAP.
      expect(main.sets.at(-1)?.setType).toBe('amrap')
    }
  })

  it('bumps +2.5 kg on presses and +5 kg on squat/deadlift per cycle', () => {
    const increments = new Map(
      p().days.map((d) => [
        d.exercises[0].wgerExerciseId,
        d.exercises[0].progression?.scheme === 'amrap-cycle'
          ? d.exercises[0].progression.incrementKg
          : null,
      ]),
    )
    expect(increments.get(WGER.ohp)).toBe(2.5)
    expect(increments.get(WGER.bench)).toBe(2.5)
    expect(increments.get(WGER.squat)).toBe(5)
    expect(increments.get(WGER.deadlift)).toBe(5)
  })
})

describe('GZCLP [G1]', () => {
  const p = () => get('GZCLP')

  it('is 4 days of T1 linear / T2 double-progression 8–10 / T3 15–25', () => {
    expect(p().days).toHaveLength(4)
    for (const day of p().days) {
      const [tier1, tier2, tier3] = day.exercises
      expect(tier1.progression?.scheme).toBe('linear')
      expect(tier1.sets).toHaveLength(5) // 5×3+
      expect(tier1.sets.at(-1)?.setType).toBe('amrap')
      expect(tier1.sets[0].repMin).toBe(3)
      expect(tier2.progression).toMatchObject({
        scheme: 'double-progression',
        repMin: 8,
        repMax: 10,
      })
      expect(tier3.progression).toMatchObject({
        scheme: 'double-progression',
        repMin: 15,
        repMax: 25,
      })
      expect(tier3.sets.at(-1)?.setType).toBe('amrap')
    }
  })

  it('T1 adds +5 kg on squat/deadlift and +2.5 kg on bench/press', () => {
    for (const day of p().days) {
      const tier1 = day.exercises[0]
      const lower = tier1.wgerExerciseId === WGER.squat || tier1.wgerExerciseId === WGER.deadlift
      expect(tier1.progression).toMatchObject({ incrementKg: lower ? 5 : 2.5 })
    }
  })
})

describe('StrongLifts 5×5 [S1]', () => {
  const p = () => get('StrongLifts 5×5')

  it('is 3 alternating full-body days squatting every session', () => {
    expect(p().days).toHaveLength(3)
    for (const day of p().days) {
      expect(day.exercises[0].wgerExerciseId).toBe(WGER.squat)
    }
  })

  it('runs linear +2.5 kg everywhere except the +5 kg single-set deadlift', () => {
    for (const day of p().days) {
      for (const exercise of day.exercises) {
        if (exercise.wgerExerciseId === WGER.deadlift) {
          expect(exercise.progression).toEqual({ scheme: 'linear', incrementKg: 5 })
          expect(exercise.sets).toHaveLength(1) // 1×5 [S1]
        } else {
          expect(exercise.progression).toEqual({ scheme: 'linear', incrementKg: 2.5 })
          expect(exercise.sets).toHaveLength(5)
          for (const s of exercise.sets) expect(s.repMin).toBe(5) // 5×5
        }
      }
    }
  })
})

describe('Push Pull Legs', () => {
  const p = () => get('Push Pull Legs')

  it('is 6 days: double-progression compounds, rep-range accessories', () => {
    expect(p().days).toHaveLength(6)
    for (const day of p().days) {
      for (const exercise of day.exercises) {
        // Every slot is either a progression-driven compound or a plain
        // rep-range accessory — no third kind.
        if (exercise.progression) {
          expect(['double-progression', 'linear']).toContain(exercise.progression.scheme)
        } else {
          for (const s of exercise.sets) {
            expect(s.repMin).not.toBeNull()
            expect(s.repMax).not.toBeNull()
          }
        }
      }
    }
  })
})

describe('Upper / Lower', () => {
  const p = () => get('Upper / Lower')

  it('is a 4-day block with a scheduled week-8 deload', () => {
    expect(p().days).toHaveLength(4)
    expect(p().mesocycleWeeks).toBe(8)
    expect(p().deloadWeek).toBe(8)
    expect(p().deloadPolicy).toMatchObject({ mode: 'scheduled' })
    expect(p().days.map((d) => d.name)).toEqual(['Upper A', 'Lower A', 'Upper B', 'Lower B'])
  })
})
