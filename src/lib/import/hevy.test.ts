import { describe, it, expect } from 'vitest'
import { parseHevy } from './hevy'

// Synthetic fixture rows only — never a real export.
const HEADER_KG =
  'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe'
const HEADER_LBS = HEADER_KG.replace('weight_kg', 'weight_lbs')

function fileKg(...rows: string[]): string {
  return [HEADER_KG, ...rows].join('\n')
}

describe('parseHevy', () => {
  it('groups set rows into workouts keyed by (start_time, title)', () => {
    const parsed = parseHevy(
      fileKg(
        'Push Day,"15 Jan 2024, 17:32","15 Jan 2024, 18:40",,Bench Press (Barbell),,,0,normal,100,5,,,',
        'Push Day,"15 Jan 2024, 17:32","15 Jan 2024, 18:40",,Bench Press (Barbell),,,1,normal,100,5,,,',
        'Push Day,"15 Jan 2024, 17:32","15 Jan 2024, 18:40",,Lateral Raise (Dumbbell),,,0,normal,10,15,,,',
      ),
    )

    expect(parsed.source).toBe('hevy')
    expect(parsed.sourceUnit).toBe('kg')
    expect(parsed.skipped).toEqual([])
    expect(parsed.workouts).toHaveLength(1)
    const [workout] = parsed.workouts
    expect(workout.name).toBe('Push Day')
    expect(workout.startedAt).toBe('2024-01-15T17:32:00.000Z')
    expect(workout.completedAt).toBe('2024-01-15T18:40:00.000Z')
    expect(workout.exercises.map((e) => e.name)).toEqual([
      'Bench Press (Barbell)',
      'Lateral Raise (Dumbbell)',
    ])
    expect(workout.exercises[0].sets[0]).toEqual({
      reps: 5,
      weightKg: 100,
      setType: 'working',
      metricMode: 'reps_weight',
      durationSec: null,
      completed: true,
    })
  })

  it('reads weight_lbs files in pounds (header-declared unit)', () => {
    const parsed = parseHevy(
      [HEADER_LBS, 'Push,"15 Jan 2024, 17:32","15 Jan 2024, 18:00",,Bench,,,0,normal,225,5,,,'].join(
        '\n',
      ),
    )
    expect(parsed.sourceUnit).toBe('lb')
    expect(parsed.workouts[0].exercises[0].sets[0].weightKg).toBeCloseTo(102.06, 2)
  })

  it("maps set_type: warmup → 'warmup'; failure/dropset → 'working'", () => {
    const parsed = parseHevy(
      fileKg(
        'Push,"15 Jan 2024, 17:32",,,Bench,,,0,warmup,60,10,,,',
        'Push,"15 Jan 2024, 17:32",,,Bench,,,1,failure,100,5,,,',
        'Push,"15 Jan 2024, 17:32",,,Bench,,,2,dropset,80,8,,,',
      ),
    )
    expect(parsed.workouts[0].exercises[0].sets.map((s) => s.setType)).toEqual([
      'warmup',
      'working',
      'working',
    ])
  })

  it('turns duration_seconds-without-reps into a duration set', () => {
    const parsed = parseHevy(fileKg('Core,"15 Jan 2024, 17:32",,,Plank,,,0,normal,,,,90,'))
    expect(parsed.workouts[0].exercises[0].sets[0]).toEqual({
      reps: null,
      weightKg: null,
      setType: 'working',
      metricMode: 'duration',
      durationSec: 90,
      completed: true,
    })
  })

  it('skips distance rows with a per-row reason', () => {
    const parsed = parseHevy(fileKg('Cardio,"15 Jan 2024, 17:32",,,Running,,,0,normal,,,5.2,1800,'))
    expect(parsed.skipped).toEqual([{ row: 2, reason: 'distance/cardio set (not imported in v1)' }])
    expect(parsed.workouts).toEqual([])
  })

  it('threads description → workout notes and exercise_notes → exercise notes', () => {
    const parsed = parseHevy(
      fileKg('Push,"15 Jan 2024, 17:32",,"Deload week",Bench,,"Slow eccentric",0,normal,100,5,,,'),
    )
    const [workout] = parsed.workouts
    expect(workout.notes).toBe('Deload week')
    expect(workout.exercises[0].notes).toBe('Slow eccentric')
  })

  it('clamps end_time spans over 6h and ignores end-before-start', () => {
    const clamped = parseHevy(
      fileKg('Push,"15 Jan 2024, 08:00","16 Jan 2024, 09:00",,Bench,,,0,normal,100,5,,,'),
    )
    expect(clamped.workouts[0].completedAt).toBe('2024-01-15T14:00:00.000Z')

    const backwards = parseHevy(
      fileKg('Push,"15 Jan 2024, 08:00","15 Jan 2024, 07:00",,Bench,,,0,normal,100,5,,,'),
    )
    expect(backwards.workouts[0].completedAt).toBe('2024-01-15T08:00:00.000Z')
  })

  it('skips rows with unparseable start times', () => {
    const parsed = parseHevy(fileKg('Push,someday,,,Bench,,,0,normal,100,5,,,'))
    expect(parsed.skipped).toEqual([{ row: 2, reason: 'unparseable start_time' }])
  })

  it('warns once about supersets and RPE, never silently dropping them', () => {
    const parsed = parseHevy(
      fileKg(
        'Push,"15 Jan 2024, 17:32",,,Bench,1,,0,normal,100,5,,,8',
        'Push,"15 Jan 2024, 17:32",,,Fly,1,,0,normal,20,12,,,8',
      ),
    )
    expect(parsed.warnings).toEqual([
      "Supersets aren't preserved — workouts don't store superset groupings.",
      'RPE values are not imported (sets store performed work, not RPE).',
    ])
  })

  it('throws on a fully empty file', () => {
    expect(() => parseHevy('')).toThrow('empty file')
  })
})
