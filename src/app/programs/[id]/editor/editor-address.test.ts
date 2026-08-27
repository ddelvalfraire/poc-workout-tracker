import { describe, expect, it } from 'vitest'
import {
  editorHref,
  parseDaySegment,
  parseExerciseParam,
  resolveEditorAddress,
  type AddressBounds,
} from './editor-address'

/** A 3-day program: day 0 has 4 exercises, day 1 has 2, day 2 has 0. */
const bounds: AddressBounds = {
  dayCount: 3,
  exerciseCountForDay: (day) => [4, 2, 0][day] ?? 0,
  mesocycleWeeks: 6,
  currentWeek: 3,
}

describe('parseDaySegment', () => {
  it('resolves an in-range segment to its 0-based position', () => {
    expect(parseDaySegment('0', 3)).toBe(0)
    expect(parseDaySegment('2', 3)).toBe(2)
  })

  it('returns null for a day the program does not have', () => {
    // Not clamped to the last day: the URL would then claim day 5 while showing
    // day 2's sets. Falling back to the structure view is the honest answer.
    expect(parseDaySegment('3', 3)).toBeNull()
    expect(parseDaySegment('99', 3)).toBeNull()
  })

  it('returns null for a segment that is not a clean integer', () => {
    // parseInt would read each of these as a number and select the wrong day.
    expect(parseDaySegment('1abc', 3)).toBeNull()
    expect(parseDaySegment('1e0', 3)).toBeNull()
    expect(parseDaySegment('-1', 3)).toBeNull()
    expect(parseDaySegment('1.5', 3)).toBeNull()
    expect(parseDaySegment(' 1', 3)).toBeNull()
    expect(parseDaySegment('', 3)).toBeNull()
    expect(parseDaySegment(undefined, 3)).toBeNull()
  })

  it('returns null for every segment when the program has no days', () => {
    expect(parseDaySegment('0', 0)).toBeNull()
  })
})

describe('parseExerciseParam', () => {
  it('resolves an in-range index within the addressed day', () => {
    expect(parseExerciseParam('2', 0, 4)).toBe(2)
  })

  it('is null without an addressed day, however valid the index looks', () => {
    // An exercise index has no day to index into; carrying it would let an
    // inspector open against whichever day appeared next.
    expect(parseExerciseParam('1', null, 4)).toBeNull()
  })

  it('clears rather than clamps when the index is out of range', () => {
    // The neighbour of a deleted exercise is a different movement, not an
    // approximation of it — so this must NOT resolve to 3.
    expect(parseExerciseParam('4', 0, 4)).toBeNull()
    expect(parseExerciseParam('99', 0, 4)).toBeNull()
  })

  it('takes the first value of a repeated param', () => {
    expect(parseExerciseParam(['1', '3'], 0, 4)).toBe(1)
  })

  it('is null for junk', () => {
    expect(parseExerciseParam('abc', 0, 4)).toBeNull()
    expect(parseExerciseParam('-1', 0, 4)).toBeNull()
    expect(parseExerciseParam(undefined, 0, 4)).toBeNull()
  })

  it('is null for every index in a day with no exercises', () => {
    expect(parseExerciseParam('0', 2, 0)).toBeNull()
  })
})

describe('resolveEditorAddress', () => {
  it('resolves a full address', () => {
    expect(resolveEditorAddress({ day: '0', exercise: '2', week: '4' }, bounds)).toEqual({
      day: 0,
      exercise: 2,
      week: 4,
    })
  })

  it('falls back to the structure view and the current week when the URL says nothing', () => {
    expect(resolveEditorAddress({}, bounds)).toEqual({ day: null, exercise: null, week: 3 })
  })

  it('checks the exercise against the ADDRESSED day, not another one', () => {
    // Day 1 has 2 exercises. Index 3 is in range for day 0 but not for day 1 —
    // resolving against the wrong day is how an inspector opens on a movement
    // that is not there.
    expect(resolveEditorAddress({ day: '1', exercise: '3' }, bounds).exercise).toBeNull()
    expect(resolveEditorAddress({ day: '0', exercise: '3' }, bounds).exercise).toBe(3)
  })

  it('drops the exercise when the day segment itself is unresolvable', () => {
    const address = resolveEditorAddress({ day: '9', exercise: '1' }, bounds)
    expect(address).toEqual({ day: null, exercise: null, week: 3 })
  })

  it('clamps an out-of-range week into the block rather than 404ing a shared link', () => {
    // Borrowed wholesale from ../week-view, so the editor and the detail page
    // can never disagree about what a given `?week=` means. A NUMBER out of
    // range clamps at both ends — it is a real answer, just not a legal one.
    expect(resolveEditorAddress({ week: '99' }, bounds).week).toBe(6)
    expect(resolveEditorAddress({ week: '0' }, bounds).week).toBe(1)
  })

  it('falls back to the current week only for non-numeric junk', () => {
    // The distinction that separates the two cases above: junk carries no
    // intent, so it lands where the user actually is.
    expect(resolveEditorAddress({ week: 'abc' }, bounds).week).toBe(3)
    expect(resolveEditorAddress({ week: undefined }, bounds).week).toBe(3)
  })

  it('never calls exerciseCountForDay when no day resolved', () => {
    // Guards the dependency order: a bounds implementation may index an array
    // by day, and calling it with null/undefined would throw or read garbage.
    let called = false
    resolveEditorAddress(
      { exercise: '1' },
      {
        ...bounds,
        exerciseCountForDay: (day) => {
          called = true
          return [4, 2, 0][day] ?? 0
        },
      },
    )
    expect(called).toBe(false)
  })
})

describe('editorHref', () => {
  it('addresses the structure view when no day is given', () => {
    expect(editorHref('p1', { day: null })).toBe('/programs/p1/editor')
    expect(editorHref('p1', {})).toBe('/programs/p1/editor')
  })

  it('puts the day in the path and the qualifiers in the query', () => {
    expect(editorHref('p1', { day: 2, exercise: 1, week: 4 })).toBe(
      '/programs/p1/editor/2?week=4&exercise=1',
    )
  })

  it('omits defaults so the common URL stays shareable', () => {
    expect(editorHref('p1', { day: 0, week: 1 })).toBe('/programs/p1/editor/0')
    expect(editorHref('p1', { day: 0, exercise: null })).toBe('/programs/p1/editor/0')
  })

  it('keeps exercise 0, which is falsy but is a real selection', () => {
    // The classic bug: `if (exercise)` drops the first exercise in every day.
    expect(editorHref('p1', { day: 0, exercise: 0 })).toBe('/programs/p1/editor/0?exercise=0')
  })

  it('keeps day 0, which is falsy but is a real day', () => {
    expect(editorHref('p1', { day: 0 })).toBe('/programs/p1/editor/0')
  })

  it('round-trips an address through the URL it builds', () => {
    // The two projections agree only if minting and resolving are inverses.
    const address = { day: 1, exercise: 1, week: 5 }
    const href = editorHref('p1', address)
    const [path, query] = href.split('?')
    const search = new URLSearchParams(query)
    expect(
      resolveEditorAddress(
        {
          day: path.split('/').pop(),
          exercise: search.get('exercise') ?? undefined,
          week: search.get('week') ?? undefined,
        },
        bounds,
      ),
    ).toEqual(address)
  })
})
