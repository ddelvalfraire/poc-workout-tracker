import { describe, it, expect } from 'vitest'
import { exerciseKey, detectPrBadges, type PrExercise, type PriorSet } from './records'

describe('exerciseKey', () => {
  it('composes source and id so a custom exercise never collides with a wger one', () => {
    expect(exerciseKey('wger', 73)).toBe('wger:73')
    expect(exerciseKey('custom', 73)).toBe('custom:73')
    expect(exerciseKey('wger', 73)).not.toBe(exerciseKey('custom', 73))
  })
})

// A weight_reps exercise; helpers keep the intent legible in each case.
function ex(over: Partial<PrExercise> & Pick<PrExercise, 'id'>): PrExercise {
  return {
    source: 'wger',
    wgerExerciseId: 73,
    loggingType: 'weight_reps',
    sets: [],
    ...over,
  }
}

function prior(sets: { reps: number | null; weight: number | null }[], over?: Partial<PriorSet>): PriorSet[] {
  return sets.map((s) => ({ source: 'wger', wgerExerciseId: 73, ...over, ...s }))
}

describe('detectPrBadges', () => {
  it('badges an exercise whose best set beats the prior best e1RM', () => {
    // Prior best e1RM: 100×5 → 116.7. Today: 110×5 → 128.3. PR.
    const badges = detectPrBadges(
      [ex({ id: 'a', sets: [{ reps: 5, weight: 110 }] })],
      prior([{ reps: 5, weight: 100 }]),
      null,
    )
    expect(badges.has('a')).toBe(true)
  })

  it('does not badge when today ties or falls short of the prior best', () => {
    const badges = detectPrBadges(
      [ex({ id: 'a', sets: [{ reps: 5, weight: 100 }] })],
      prior([{ reps: 5, weight: 100 }]),
      null,
    )
    expect(badges.has('a')).toBe(false)
  })

  it('does not badge an exercise with no prior history (a first-ever set is not a PR)', () => {
    const badges = detectPrBadges([ex({ id: 'a', sets: [{ reps: 5, weight: 100 }] })], [], null)
    expect(badges.size).toBe(0)
  })

  it('judges the best set across ALL of an exercise cards and badges the FIRST card only', () => {
    // Two cards of the same exercise; the PR set is in the second card, but the
    // badge lands on the first card's row id.
    const badges = detectPrBadges(
      [
        ex({ id: 'first', sets: [{ reps: 5, weight: 90 }] }),
        ex({ id: 'second', sets: [{ reps: 5, weight: 130 }] }),
      ],
      prior([{ reps: 5, weight: 100 }]),
      null,
    )
    expect(badges.has('first')).toBe(true)
    expect(badges.has('second')).toBe(false)
  })

  it('badges on a rep PR when nothing is load-scorable (bodyweight, no stored bodyweight)', () => {
    // No bodyweight → bodyweight_reps sets fall back to the rep axis.
    const badges = detectPrBadges(
      [
        ex({
          id: 'a',
          source: 'wger',
          wgerExerciseId: 91,
          loggingType: 'bodyweight_reps',
          sets: [{ reps: 12, weight: null }],
        }),
      ],
      prior([{ reps: 10, weight: null }], { wgerExerciseId: 91 }),
      null,
    )
    expect(badges.has('a')).toBe(true)
  })

  it('does not badge mixed kinds (a rep-scored today against an e1rm-scored past)', () => {
    // Same weight_reps type, but today's set carries no weight (reps fallback)
    // while the past was weighted (e1rm) — no honest common axis, so no badge,
    // even though 20 reps "feels" bigger than a 5-rep set.
    const badges = detectPrBadges(
      [ex({ id: 'a', sets: [{ reps: 20, weight: null }] })],
      prior([{ reps: 5, weight: 100 }]),
      null,
    )
    expect(badges.has('a')).toBe(false)
  })

  it('keys on the (source, id) composite so a custom exercise is judged against its own history', () => {
    // Custom 73 today would be a PR against wger-73's history — but must not
    // borrow it. With no custom-73 prior, there is nothing to beat → no badge.
    const badges = detectPrBadges(
      [ex({ id: 'a', source: 'custom', wgerExerciseId: 73, sets: [{ reps: 5, weight: 130 }] })],
      prior([{ reps: 5, weight: 100 }], { source: 'wger', wgerExerciseId: 73 }),
      null,
    )
    expect(badges.has('a')).toBe(false)
  })

  it('scores bodyweight-type sets against the stored bodyweight when present', () => {
    // weighted_bodyweight: effective load = bodyweight + added weight.
    // Today 80bw + 40 = 120 @5 → 140. Prior 80bw + 20 = 100 @5 → 116.7. PR.
    const badges = detectPrBadges(
      [
        ex({
          id: 'a',
          wgerExerciseId: 55,
          loggingType: 'weighted_bodyweight',
          sets: [{ reps: 5, weight: 40 }],
        }),
      ],
      prior([{ reps: 5, weight: 20 }], { wgerExerciseId: 55 }),
      80,
    )
    expect(badges.has('a')).toBe(true)
  })
})
