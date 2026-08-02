import { describe, it, expect } from 'vitest'
import { parseStrong, parseStrongDuration } from './strong'

// Synthetic fixture rows only — never a real export.
const HEADER =
  'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE'

function file(...rows: string[]): string {
  return [HEADER, ...rows].join('\n')
}

describe('parseStrong', () => {
  it('groups set rows into one workout with exercises in first-seen order', () => {
    const parsed = parseStrong(
      file(
        '2024-01-15 17:32:11,Push Day,1h 12m,Bench Press (Barbell),1,100,5,,,,,',
        '2024-01-15 17:32:11,Push Day,1h 12m,Bench Press (Barbell),2,100,5,,,,,',
        '2024-01-15 17:32:11,Push Day,1h 12m,Overhead Press (Barbell),1,60,8,,,,,',
      ),
      'kg',
    )

    expect(parsed.source).toBe('strong')
    expect(parsed.sourceUnit).toBe('kg')
    expect(parsed.skipped).toEqual([])
    expect(parsed.workouts).toHaveLength(1)
    const [workout] = parsed.workouts
    expect(workout.name).toBe('Push Day')
    expect(workout.startedAt).toBe('2024-01-15T17:32:11.000Z')
    // completedAt = start + 1h 12m
    expect(workout.completedAt).toBe('2024-01-15T18:44:11.000Z')
    expect(workout.exercises.map((e) => e.name)).toEqual([
      'Bench Press (Barbell)',
      'Overhead Press (Barbell)',
    ])
    expect(workout.exercises[0].sets).toHaveLength(2)
    expect(workout.exercises[0].sets[0]).toEqual({
      reps: 5,
      weightKg: 100,
      setType: 'working',
      metricMode: 'reps_weight',
      durationSec: null,
      completed: true,
    })
  })

  it('splits distinct (date, name) pairs into distinct workouts', () => {
    const parsed = parseStrong(
      file(
        '2024-01-15 17:32:11,Push Day,45m,Bench Press (Barbell),1,100,5,,,,,',
        '2024-01-17 09:00:00,Pull Day,45m,Deadlift (Barbell),1,180,3,,,,,',
      ),
      'kg',
    )
    expect(parsed.workouts).toHaveLength(2)
  })

  it('converts lb weights to canonical kg when the picker says lb', () => {
    const parsed = parseStrong(file('2024-01-15 17:32:11,Push,45m,Bench,1,225,5,,,,,'), 'lb')
    expect(parsed.workouts[0].exercises[0].sets[0].weightKg).toBeCloseTo(102.06, 2)
  })

  it('maps Set Order "W" to a warmup set (case-insensitive)', () => {
    const parsed = parseStrong(
      file(
        '2024-01-15 17:32:11,Push,45m,Bench,W,60,10,,,,,',
        '2024-01-15 17:32:11,Push,45m,Bench,w,80,5,,,,,',
        '2024-01-15 17:32:11,Push,45m,Bench,1,100,5,,,,,',
      ),
      'kg',
    )
    const types = parsed.workouts[0].exercises[0].sets.map((s) => s.setType)
    expect(types).toEqual(['warmup', 'warmup', 'working'])
  })

  it('treats failure/drop markers as working sets, not skips', () => {
    const parsed = parseStrong(file('2024-01-15 17:32:11,Push,45m,Bench,F,100,5,,,,,'), 'kg')
    expect(parsed.workouts[0].exercises[0].sets[0].setType).toBe('working')
  })

  it('turns seconds-without-reps into a duration set', () => {
    const parsed = parseStrong(file('2024-01-15 17:32:11,Core,30m,Plank,1,,,,90,,,'), 'kg')
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
    const parsed = parseStrong(
      file(
        '2024-01-15 17:32:11,Cardio,30m,Running,1,,,5.2,1800,,,',
        '2024-01-15 17:32:11,Cardio,30m,Bench,1,100,5,,,,,',
      ),
      'kg',
    )
    expect(parsed.skipped).toEqual([{ row: 2, reason: 'distance/cardio set (not imported in v1)' }])
    expect(parsed.workouts[0].exercises.map((e) => e.name)).toEqual(['Bench'])
  })

  it('skips rows with unparseable dates and missing exercise names', () => {
    const parsed = parseStrong(
      file('not-a-date,Push,45m,Bench,1,100,5,,,,,', '2024-01-15 17:32:11,Push,45m,,1,100,5,,,,,'),
      'kg',
    )
    expect(parsed.skipped).toEqual([
      { row: 2, reason: 'unparseable date' },
      { row: 3, reason: 'missing exercise name' },
    ])
    expect(parsed.workouts).toEqual([])
  })

  it('skips out-of-range weights instead of overflowing the column', () => {
    const parsed = parseStrong(file('2024-01-15 17:32:11,Push,45m,Bench,1,999999,5,,,,,'), 'kg')
    expect(parsed.skipped).toEqual([{ row: 2, reason: 'weight out of range' }])
  })

  it('threads workout notes and exercise notes (first non-empty wins)', () => {
    const parsed = parseStrong(
      file(
        '2024-01-15 17:32:11,Push,45m,Bench,1,100,5,,,Felt heavy,Great session,',
        '2024-01-15 17:32:11,Push,45m,Bench,2,100,5,,,Different note,Other,',
      ),
      'kg',
    )
    const [workout] = parsed.workouts
    expect(workout.notes).toBe('Great session')
    expect(workout.exercises[0].notes).toBe('Felt heavy')
  })

  it('handles quoted names with commas and CRLF endings', () => {
    const parsed = parseStrong(
      `${HEADER}\r\n2024-01-15 17:32:11,"Push, week 1",45m,"Press, Machine (Seated)",1,50,10,,,,,\r\n`,
      'kg',
    )
    expect(parsed.workouts[0].name).toBe('Push, week 1')
    expect(parsed.workouts[0].exercises[0].name).toBe('Press, Machine (Seated)')
  })

  it('clamps implausible durations to 6h', () => {
    const parsed = parseStrong(file('2024-01-15 08:00:00,Push,26h 30m,Bench,1,100,5,,,,,'), 'kg')
    expect(parsed.workouts[0].completedAt).toBe('2024-01-15T14:00:00.000Z')
  })

  it('surfaces an RPE warning when the column is populated', () => {
    const parsed = parseStrong(file('2024-01-15 17:32:11,Push,45m,Bench,1,100,5,,,,,8.5'), 'kg')
    expect(parsed.warnings).toEqual([
      'RPE values are not imported (sets store performed work, not RPE).',
    ])
  })

  it('throws on a fully empty file', () => {
    expect(() => parseStrong('', 'kg')).toThrow('empty file')
  })
})

describe('parseStrongDuration', () => {
  it('parses hour/minute/second combinations', () => {
    expect(parseStrongDuration('1h 12m')).toBe(4320)
    expect(parseStrongDuration('45m')).toBe(2700)
    expect(parseStrongDuration('1h')).toBe(3600)
    expect(parseStrongDuration('90s')).toBe(90)
    expect(parseStrongDuration('1h 2m 3s')).toBe(3723)
  })

  it('returns null for blanks and unrecognized formats', () => {
    expect(parseStrongDuration('')).toBeNull()
    expect(parseStrongDuration('about an hour')).toBeNull()
  })
})
