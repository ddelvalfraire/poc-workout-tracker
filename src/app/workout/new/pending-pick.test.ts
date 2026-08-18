import { describe, it, expect } from 'vitest'
import { parsePendingPick, type PendingPick } from './pending-pick'

/**
 * The #218 return-leg trust boundary: the instruction crosses sessionStorage
 * between two pages, so the parser must accept exactly the shapes the create
 * page writes and reject everything else — a malformed value must degrade to
 * "no instruction", never to a corrupted swap.
 */

const EXERCISE = {
  wgerExerciseId: 42,
  source: 'custom' as const,
  name: 'Nordic Curl',
  category: 'Legs',
}

describe('parsePendingPick', () => {
  it('round-trips a swap instruction', () => {
    const pick: PendingPick = { mode: 'swap', targetId: 'ex-abc', exercise: EXERCISE }
    expect(parsePendingPick(JSON.stringify(pick))).toEqual(pick)
  })

  it('round-trips an add instruction', () => {
    const pick: PendingPick = { mode: 'add', exercise: EXERCISE }
    expect(parsePendingPick(JSON.stringify(pick))).toEqual(pick)
  })

  it('accepts a wger-sourced exercise (use-existing routes the same leg)', () => {
    const pick: PendingPick = {
      mode: 'add',
      exercise: { ...EXERCISE, source: 'wger' },
    }
    expect(parsePendingPick(JSON.stringify(pick))).toEqual(pick)
  })

  it('rejects absent and non-string values', () => {
    expect(parsePendingPick(null)).toBeNull()
    expect(parsePendingPick(undefined)).toBeNull()
    expect(parsePendingPick(7)).toBeNull()
    expect(parsePendingPick('')).toBeNull()
  })

  it('rejects malformed JSON and non-object payloads', () => {
    expect(parsePendingPick('{nope')).toBeNull()
    expect(parsePendingPick('"swap"')).toBeNull()
    expect(parsePendingPick('null')).toBeNull()
  })

  it('rejects an unknown mode', () => {
    expect(
      parsePendingPick(JSON.stringify({ mode: 'replace', targetId: 'x', exercise: EXERCISE })),
    ).toBeNull()
  })

  it('rejects a swap without a target id', () => {
    expect(parsePendingPick(JSON.stringify({ mode: 'swap', exercise: EXERCISE }))).toBeNull()
    expect(
      parsePendingPick(JSON.stringify({ mode: 'swap', targetId: '', exercise: EXERCISE })),
    ).toBeNull()
  })

  it('rejects a malformed exercise identity', () => {
    const cases: Record<string, unknown>[] = [
      { ...EXERCISE, wgerExerciseId: 0 },
      { ...EXERCISE, wgerExerciseId: 1.5 },
      { ...EXERCISE, wgerExerciseId: '42' },
      { ...EXERCISE, source: 'library' },
      { ...EXERCISE, name: '' },
      { ...EXERCISE, name: undefined },
      { ...EXERCISE, category: undefined },
    ]
    for (const exercise of cases) {
      expect(parsePendingPick(JSON.stringify({ mode: 'add', exercise }))).toBeNull()
    }
  })
})
