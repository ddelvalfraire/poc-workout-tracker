import { describe, it, expect } from 'vitest'
import { correctionReach, type ReachRecords, type SettledDecision } from './record-reach'

/**
 * The reach's contract, and the silence it depends on.
 *
 * The gate is the load-bearing part: an ordinary typo fix gets NOTHING. Put
 * this disclosure on every edit and it becomes the thing people scroll past
 * to reach the save button — at which point the one edit that really does
 * move a record reads exactly like the hundred that did not.
 */

const AT = new Date('2026-08-14T17:04:00.000Z')
const LATER = new Date('2026-08-21T17:04:00.000Z')

function board(overrides: Partial<ReachRecords> = {}): ReachRecords {
  return {
    bestE1rm: { workoutId: 'w1', performedAt: AT, e1rm: 122.5 },
    heaviestLoadKg: { workoutId: 'w1', performedAt: AT, weightKg: 100 },
    mostReps: { workoutId: 'w1', performedAt: AT, reps: 8 },
    bestSessionVolumeKg: { workoutId: 'w1', performedAt: AT, volumeKg: 2400 },
    ...overrides,
  }
}

const TRAINING_MAX: SettledDecision = {
  kind: 'trainingMax',
  valueKg: 102.5,
  decidedAt: AT,
  sessionsSince: 3,
}

describe('correctionReach', () => {
  it('says nothing at all when the correction moves no record', () => {
    // Arrange — the typo fix: a number changed, but no slot changed hands
    const stored = board()

    // Act
    const reach = correctionReach(stored, board(), TRAINING_MAX)

    // Assert — absent, not an empty disclosure
    expect(reach).toBeNull()
  })

  it('names a record whose HOLDER changes', () => {
    const reach = correctionReach(
      board(),
      board({ heaviestLoadKg: { workoutId: 'w9', performedAt: LATER, weightKg: 100 } }),
    )
    expect(reach?.items.map((item) => item.kind)).toEqual(['heaviestLoad'])
  })

  it('names a record whose VALUE changes under the same holder', () => {
    // Correcting the record-holding set downward: same session, lower number.
    const reach = correctionReach(
      board(),
      board({ heaviestLoadKg: { workoutId: 'w1', performedAt: AT, weightKg: 95 } }),
    )
    expect(reach?.items.map((item) => item.kind)).toEqual(['heaviestLoad'])
  })

  it('quotes the value that stands TODAY, not what it would become', () => {
    // The reader recognises the current record; naming what it would turn
    // into is a promise about a save that has not happened yet.
    const reach = correctionReach(
      board(),
      board({ heaviestLoadKg: { workoutId: 'w1', performedAt: AT, weightKg: 95 } }),
    )
    expect(reach?.items[0]).toMatchObject({ value: 100, performedAt: AT })
  })

  it('reports a slot that gains or loses a holder entirely', () => {
    const emptied = correctionReach(board(), board({ mostReps: null }))
    expect(emptied?.items.map((item) => item.kind)).toEqual(['mostReps'])

    const filled = correctionReach(board({ mostReps: null }), board())
    expect(filled?.items.map((item) => item.kind)).toEqual(['mostReps'])
    // Nothing held the slot before, so there is no date to quote.
    expect(filled?.items[0].performedAt).toBeNull()
  })

  it('carries the settled decision only when something actually moves', () => {
    // A training max nothing is threatening needs no defending.
    expect(correctionReach(board(), board(), TRAINING_MAX)).toBeNull()

    const reach = correctionReach(board(), board({ bestE1rm: null }), TRAINING_MAX)
    expect(reach?.settled).toEqual(TRAINING_MAX)
  })

  it('reports every slot that moved, in board order', () => {
    const reach = correctionReach(
      board(),
      board({
        bestE1rm: null,
        mostReps: { workoutId: 'w1', performedAt: AT, reps: 6 },
      }),
    )
    expect(reach?.items.map((item) => item.kind)).toEqual(['bestE1rm', 'mostReps'])
  })

  it('never mutates the boards it is given', () => {
    const stored = board()
    const snapshot = structuredClone(stored)
    correctionReach(stored, board({ bestE1rm: null }), TRAINING_MAX)
    expect(stored).toEqual(snapshot)
  })
})
