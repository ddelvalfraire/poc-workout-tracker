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

describe('Starting Strength', () => {
  const p = () => get('Starting Strength')

  it('is 3 alternating days of 3×5 on session-linear load', () => {
    expect(p().days).toHaveLength(3)
    for (const day of p().days) {
      expect(day.exercises[0].wgerExerciseId).toBe(WGER.squat)
      expect(day.exercises[0].sets).toHaveLength(3)
      expect(day.exercises[0].progression).toEqual({ scheme: 'linear', incrementKg: 5 })
    }
  })

  it('pulls once per day: a heavy single-set deadlift or the clean', () => {
    const [a, b] = p().days
    expect(a.exercises.at(-1)).toMatchObject({ wgerExerciseId: WGER.deadlift })
    expect(a.exercises.at(-1)?.sets).toHaveLength(1) // 1×5
    expect(b.exercises.at(-1)).toMatchObject({ wgerExerciseId: WGER.powerClean })
    expect(b.exercises.at(-1)?.sets).toHaveLength(5) // 5×3
  })
})

describe('Greyskull LP', () => {
  const p = () => get('Greyskull LP')

  it('ends every main lift with an AMRAP — the program’s whole idea', () => {
    for (const day of p().days) {
      const main = day.exercises[0]
      expect(main.progression?.scheme).toBe('linear')
      expect(main.sets.at(-1)?.setType).toBe('amrap')
      expect(main.sets.at(-1)?.repMax).toBeNull() // open-ended, not a range
    }
  })

  it('squats every session and never schedules a deload week', () => {
    for (const day of p().days) {
      expect(day.exercises.map((e) => e.wgerExerciseId)).toContain(WGER.squat)
    }
    expect(p().deloadWeek).toBeUndefined()
    expect(p().deloadPolicy).toEqual({ mode: 'reactive' })
  })
})

describe('Madcow 5×5', () => {
  const p = () => get('Madcow 5×5')

  it('ramps to a top set on Monday, cuts the ramp short on Wednesday', () => {
    const [monday, wednesday] = p().days
    for (const exercise of monday.exercises) {
      expect(exercise.progression).toMatchObject({
        scheme: 'amrap-cycle',
        wave: [[0.5, 0.625, 0.75, 0.875, 1.0]],
      })
      expect(exercise.sets).toHaveLength(5)
    }
    for (const exercise of wednesday.exercises) {
      expect(exercise.sets).toHaveLength(3) // the same ramp, three rungs up
    }
  })

  it('goes past the top for a Friday triple, then one back-off set of eight', () => {
    for (const exercise of p().days[2].exercises) {
      expect(exercise.progression).toMatchObject({
        wave: [[0.5, 0.625, 0.75, 0.875, 1.05, 0.75]],
        waveReps: [[5, 5, 5, 5, 3, 8]],
      })
      expect(exercise.sets[4].setType).toBe('amrap') // the record set
      expect(exercise.sets[5].repMin).toBe(8)
    }
  })

  it('climbs +2.5 kg per week and never chases the log', () => {
    for (const day of p().days) {
      for (const exercise of day.exercises) {
        expect(exercise.progression).toMatchObject({ incrementKg: 2.5 })
      }
    }
    expect(p().planSync).toBe(false)
  })
})

describe('Texas Method', () => {
  const p = () => get('Texas Method')

  it('separates volume, recovery and intensity across three days', () => {
    expect(p().days.map((d) => d.name)).toEqual([
      'Monday · Volume',
      'Wednesday · Recovery',
      'Friday · Intensity',
    ])
  })

  it('is 5×5 on Monday and a single heavy five on Friday', () => {
    const [monday, , friday] = p().days
    expect(monday.exercises[0].sets).toHaveLength(5)
    for (const exercise of friday.exercises) {
      expect(exercise.sets).toHaveLength(1)
      expect(exercise.sets[0].repMin).toBe(5)
    }
  })

  it('leaves Wednesday’s squat unprogressed — recovery is not a place to earn anything', () => {
    const wednesday = p().days[1]
    const squat = wednesday.exercises[0]
    expect(squat.wgerExerciseId).toBe(WGER.squat)
    expect(squat.sets).toHaveLength(2)
    expect(squat.progression ?? null).toBeNull()
  })
})

describe('nSuns 5/3/1 LP', () => {
  const p = () => get('nSuns 5/3/1 LP')

  it('runs a 9-set T1 ladder with two AMRAPs and an 8-set T2 behind it', () => {
    for (const day of p().days) {
      const [t1, t2] = day.exercises
      expect(t1.sets).toHaveLength(9)
      expect(t1.sets.filter((s) => s.setType === 'amrap')).toHaveLength(2)
      expect(t1.sets[2].setType).toBe('amrap') // the top single
      expect(t1.sets[8].setType).toBe('amrap') // the last back-off five
      expect(t2.sets).toHaveLength(8)
      expect(t2.progression?.scheme).toBe('amrap-cycle')
    }
  })

  it('bumps the TM every WEEK — a single-row wave, not a 3-week cycle', () => {
    for (const day of p().days) {
      const t1 = day.exercises[0]
      if (t1.progression?.scheme !== 'amrap-cycle') throw new Error('T1 must be a ladder')
      expect(t1.progression.wave).toHaveLength(1)
      expect(t1.progression.incrementKg).toBeGreaterThan(0)
    }
  })
})

describe('Candito 6-Week Strength', () => {
  const p = () => get('Candito 6-Week Strength')

  it('is a 6-week block that deloads on the last week', () => {
    expect(p().mesocycleWeeks).toBe(6)
    expect(p().deloadWeek).toBe(6)
    expect(p().deloadPolicy).toMatchObject({ mode: 'scheduled', shape: { loadFactor: 0.6 } })
  })

  it('walks reps down and percentages up across the five working weeks', () => {
    for (const day of p().days) {
      const main = day.exercises[0]
      if (main.progression?.scheme !== 'amrap-cycle') throw new Error('main must be a ladder')
      const { wave, waveReps } = main.progression
      expect(wave).toHaveLength(5)
      // The measure is the HEAVIEST set of each week, not the max across the
      // row: weeks 4–5 end on a lighter back-off set that carries more reps
      // than the top single, and that back-off is the point, not a drift.
      const topSet = wave.map((row) => row.indexOf(Math.max(...row)))
      const topPercents = wave.map((row, i) => row[topSet[i]])
      const topReps = topSet.map((setIdx, i) => waveReps?.[i][setIdx] ?? 0)
      // Strictly heavier week over week, with the top set's reps walking down.
      for (let i = 1; i < topPercents.length; i++) {
        expect(topPercents[i]).toBeGreaterThan(topPercents[i - 1])
        expect(topReps[i]).toBeLessThan(topReps[i - 1])
      }
    }
  })

  it('peaks inside the block rather than bumping the TM out of it', () => {
    for (const day of p().days) {
      expect(day.exercises[0].progression).toMatchObject({ incrementKg: 0 })
    }
  })
})

describe('Smolov Jr', () => {
  const p = () => get('Smolov Jr')

  it('is one lift, four days, at the published set/rep/percentage grid', () => {
    const grid = p().days.map((d) => {
      const main = d.exercises[0]
      if (main.progression?.scheme !== 'amrap-cycle') throw new Error('main must be a ladder')
      return [main.sets.length, main.progression.waveReps?.[0][0], main.progression.wave[0][0]]
    })
    expect(grid).toEqual([
      [6, 6, 0.7],
      [7, 5, 0.75],
      [8, 4, 0.8],
      [10, 3, 0.85],
    ])
  })

  it('trains exactly one movement and adds nothing else', () => {
    for (const day of p().days) {
      expect(day.exercises).toHaveLength(1)
      expect(day.exercises[0].wgerExerciseId).toBe(WGER.bench)
    }
  })

  it('never deloads — three weeks then a test, not a block with a taper', () => {
    expect(p().mesocycleWeeks).toBe(3)
    expect(p().deloadWeek).toBeUndefined()
    expect(p().deloadPolicy).toEqual({ mode: 'none' })
  })
})

describe('PHUL', () => {
  const p = () => get('PHUL')

  it('is two power days at 3–5 then two hypertrophy days at 8+', () => {
    const [upperPower, lowerPower, upperHyp, lowerHyp] = p().days
    for (const day of [upperPower, lowerPower]) {
      expect(day.exercises[0].progression).toMatchObject({ repMin: 3, repMax: 5 })
      expect(day.exercises[0].sets[0].restSec).toBe(210) // long rests, heavy work
    }
    for (const day of [upperHyp, lowerHyp]) {
      for (const exercise of day.exercises) {
        expect(exercise.sets[0].repMin).toBeGreaterThanOrEqual(8)
        expect(exercise.sets.at(-1)?.setType).toBe('amrap')
      }
    }
  })
})

describe('PHAT', () => {
  const p = () => get('PHAT')

  it('is five days: two power, three hypertrophy', () => {
    expect(p().days.map((d) => d.name)).toEqual([
      'Upper Power',
      'Lower Power',
      'Back · Shoulders',
      'Lower Hypertrophy',
      'Chest · Arms',
    ])
  })

  it('opens the week pulling, not pressing', () => {
    expect(p().days[0].exercises[0].wgerExerciseId).toBe(WGER.row)
  })
})

describe('Arnold Split', () => {
  const p = () => get('Arnold Split')

  it('is 6 days pairing antagonists, legs twice', () => {
    expect(p().days).toHaveLength(6)
    expect(p().days.map((d) => d.name)).toEqual([
      'Chest · Back',
      'Shoulders · Arms',
      'Legs · Core',
      'Chest · Back (2)',
      'Shoulders · Arms (2)',
      'Legs · Core (2)',
    ])
  })

  it('deloads hard in week 6 — 80% load, half the sets', () => {
    expect(p().deloadPolicy).toMatchObject({
      mode: 'scheduled',
      shape: { loadFactor: 0.8, setFactor: 0.5 },
    })
  })
})

describe('Body Part Split', () => {
  const p = () => get('Body Part Split')

  it('is one muscle a day across five days, each opening with a compound', () => {
    expect(p().days.map((d) => d.name)).toEqual(['Chest', 'Back', 'Shoulders', 'Legs', 'Arms'])
    for (const day of p().days) {
      expect(day.exercises[0].progression?.scheme).toBe('double-progression')
      expect(day.exercises[0].sets[0].restSec).toBe(150)
    }
  })
})

describe('Full Body Hypertrophy', () => {
  const p = () => get('Full Body Hypertrophy')

  it('drives every slot by volume landmarks, starting at MEV', () => {
    for (const day of p().days) {
      for (const exercise of day.exercises) {
        const progression = exercise.progression
        if (progression?.scheme !== 'weekly-volume') throw new Error('every slot ramps volume')
        expect(progression.mevSets).toBeLessThan(progression.mrvSets)
        // Week 1 plans exactly MEV sets — the ramp starts where it says it does.
        expect(exercise.sets).toHaveLength(progression.mevSets)
      }
    }
  })

  it('asks for a check-in, because the model needs feedback to be honest', () => {
    expect(p().checkInEveryDays).toBe(14)
  })
})

describe('Recommended Routine', () => {
  const p = () => get('Recommended Routine')

  it('supersets every day into three pairs', () => {
    for (const day of p().days) {
      expect(day.exercises).toHaveLength(6)
      const groups = day.exercises.map((e) => e.supersetGroup)
      expect(groups).toEqual([1, 1, 2, 2, 3, 3])
    }
  })

  it('progresses reps and seconds, never load', () => {
    for (const day of p().days) {
      for (const exercise of day.exercises) {
        expect(exercise.progression?.scheme).toBe('rep-progression')
      }
    }
  })

  it('holds are timed sets with a real ceiling', () => {
    const plank = p().days[0].exercises[4]
    expect(plank.wgerExerciseId).toBe(WGER.plank)
    expect(plank.sets[0].metricMode).toBe('duration')
    expect(plank.sets[0].durationSec).toBe(45)
    expect(plank.progression).toMatchObject({ incrementSec: 5, maxSec: 120 })
  })
})

describe('Dumbbell Only', () => {
  const p = () => get('Dumbbell Only')

  it('is three full-body days that never name a barbell-only lift', () => {
    expect(p().days).toHaveLength(3)
    const barbellOnly = new Set<number>([WGER.squat, WGER.bench, WGER.deadlift, WGER.ohp, WGER.row])
    for (const day of p().days) {
      for (const exercise of day.exercises) {
        expect(barbellOnly.has(exercise.wgerExerciseId)).toBe(false)
      }
    }
  })
})

describe('Kettlebell Simple & Sinister', () => {
  const p = () => get('Kettlebell Simple & Sinister')

  it('is one day of two timed movements with no scheme at all', () => {
    expect(p().days).toHaveLength(1)
    const [swing, getUp] = p().days[0].exercises
    expect(swing.wgerExerciseId).toBe(WGER.kettlebellSwing)
    expect(swing.sets).toHaveLength(10)
    expect(getUp.wgerExerciseId).toBe(WGER.turkishGetUp)
    // Progress is rest compression and a heavier bell — neither is the
    // engine's to apply, so nothing here carries a progression.
    for (const exercise of p().days[0].exercises) {
      expect(exercise.sets[0].metricMode).toBe('duration')
      expect(exercise.progression ?? null).toBeNull()
    }
  })

  it('is a practice, not a block — no deload, no plan-chasing', () => {
    expect(p().deloadWeek).toBeUndefined()
    expect(p().deloadPolicy).toEqual({ mode: 'reactive' })
    expect(p().planSync).toBe(false)
  })
})

describe('Couch to 5K', () => {
  const p = () => get('Couch to 5K')

  it('opens every run with a five-minute walk', () => {
    for (const day of p().days) {
      const warmup = day.exercises[0]
      expect(warmup.wgerExerciseId).toBe(WGER.walking)
      expect(warmup.sets).toHaveLength(1)
      expect(warmup.sets[0].durationSec).toBe(300)
    }
  })

  it('alternates jog and walk legs, both timed AND measured', () => {
    for (const day of p().days) {
      const run = day.exercises[1]
      expect(run.sets.length % 2).toBe(0) // jog/walk pairs
      for (const s of run.sets) {
        expect(s.metricMode).toBe('duration_distance')
        expect(s.durationSec).toBeGreaterThan(0)
        expect(s.distanceM).toBeGreaterThan(0)
      }
    }
  })

  it('grows the jog in seconds toward a continuous half hour', () => {
    for (const day of p().days) {
      expect(day.exercises[1].progression).toMatchObject({
        scheme: 'rep-progression',
        maxSec: 1800,
      })
    }
  })

  it('never deloads — nine weeks of one direction', () => {
    expect(p().mesocycleWeeks).toBe(9)
    expect(p().deloadPolicy).toEqual({ mode: 'none' })
  })
})

describe('Hybrid Strength & Endurance', () => {
  const p = () => get('Hybrid Strength & Endurance')

  it('alternates lifting and aerobic days so neither lands on the other', () => {
    expect(p().days.map((d) => d.name)).toEqual([
      'Lift · Lower',
      'Easy aerobic',
      'Lift · Upper',
      'Long aerobic',
    ])
  })

  it('is the one program whose deload scales the CLOCK as well as the bar', () => {
    expect(p().deloadPolicy).toMatchObject({
      mode: 'scheduled',
      shape: { timedExercises: 'scaled' },
    })
  })
})
