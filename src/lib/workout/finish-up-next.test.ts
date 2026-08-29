import { describe, it, expect } from 'vitest'
import { resolveFinishUpNext } from './finish-up-next'

describe('resolveFinishUpNext', () => {
  it('returns none for a quick-log workout with no program provenance', () => {
    expect(resolveFinishUpNext(null, { blockComplete: false })).toEqual({
      kind: 'none',
    })
  })

  it('returns none when no next day resolved (archived program, deleted day)', () => {
    expect(resolveFinishUpNext('day-1', null)).toEqual({ kind: 'none' })
  })

  it('returns next-day for a program workout with a day still to train', () => {
    const next = { blockComplete: false }

    expect(resolveFinishUpNext('day-1', next)).toEqual({
      kind: 'next-day',
      next,
    })
  })

  it('returns block-complete when the mesocycle finished its final week', () => {
    const next = { blockComplete: true }

    expect(resolveFinishUpNext('day-1', next)).toEqual({
      kind: 'block-complete',
      next,
    })
  })
})
