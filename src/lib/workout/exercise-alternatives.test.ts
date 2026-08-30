import { describe, it, expect } from 'vitest'
import { rankAlternatives, isCompound, type AlternativeCandidate } from './exercise-alternatives'

/** A catalog entry with quiet defaults — tests override what they exercise. */
function ex(over: Partial<AlternativeCandidate> & { id: number; name: string }): AlternativeCandidate {
  return { category: 'Chest', equipment: [], muscles: [], musclesSecondary: [], ...over }
}

describe('rankAlternatives', () => {
  it('requires a shared PRIMARY muscle — a curl never suggests a row', () => {
    // Arrange — the row hits biceps only as a SECONDARY mover
    const curl = ex({ id: 1, name: 'Curl', category: 'Arms', muscles: ['Biceps'] })
    const row = ex({
      id: 2,
      name: 'Row',
      category: 'Back',
      muscles: ['Back'],
      musclesSecondary: ['Biceps'],
    })
    const hammerCurl = ex({ id: 3, name: 'Hammer Curl', category: 'Arms', muscles: ['Biceps'] })

    // Act
    const ranked = rankAlternatives(1, [curl, row, hammerCurl])

    // Assert
    expect(ranked.map((e) => e.name)).toEqual(['Hammer Curl'])
  })

  it('ranks more shared primary muscles higher', () => {
    const current = ex({ id: 1, name: 'Deadlift', muscles: ['Back', 'Glutes'] })
    const oneShared = ex({ id: 2, name: 'Pulldown', muscles: ['Back'] })
    const twoShared = ex({ id: 3, name: 'Rack Pull', muscles: ['Back', 'Glutes'] })

    const ranked = rankAlternatives(1, [current, oneShared, twoShared])

    expect(ranked.map((e) => e.name)).toEqual(['Rack Pull', 'Pulldown'])
  })

  it('prefers movement-scale parity: a compound suggests compounds before isolations', () => {
    // Arrange — press shares Chest and is compound (has secondaries); the fly
    // shares Chest but is an isolation. Same category, same equipment.
    const bench = ex({ id: 1, name: 'Bench Press', muscles: ['Chest'], musclesSecondary: ['Triceps'] })
    const fly = ex({ id: 2, name: 'Cable Fly', muscles: ['Chest'] })
    const press = ex({ id: 3, name: 'Incline Press', muscles: ['Chest'], musclesSecondary: ['Shoulders'] })

    const ranked = rankAlternatives(1, [bench, fly, press])

    expect(ranked.map((e) => e.name)).toEqual(['Incline Press', 'Cable Fly'])
  })

  it('boosts same-category candidates over equal matches elsewhere', () => {
    const current = ex({ id: 1, name: 'Bench Press', category: 'Chest', muscles: ['Chest'] })
    const otherCategory = ex({ id: 2, name: 'Dip', category: 'Arms', muscles: ['Chest'] })
    const sameCategory = ex({ id: 3, name: 'Push Up', category: 'Chest', muscles: ['Chest'] })

    const ranked = rankAlternatives(1, [current, otherCategory, sameCategory])

    expect(ranked.map((e) => e.name)).toEqual(['Push Up', 'Dip'])
  })

  it('penalizes candidates sharing the current (taken) equipment', () => {
    const current = ex({ id: 1, name: 'Machine Press', muscles: ['Chest'], equipment: ['Machine'] })
    const sameMachine = ex({ id: 2, name: 'Machine Fly Press', muscles: ['Chest'], equipment: ['Machine'] })
    const dumbbell = ex({ id: 3, name: 'Dumbbell Press', muscles: ['Chest'], equipment: ['Dumbbell'] })

    const ranked = rankAlternatives(1, [current, sameMachine, dumbbell])

    expect(ranked.map((e) => e.name)).toEqual(['Dumbbell Press', 'Machine Fly Press'])
  })

  it('excludes the current exercise itself', () => {
    const current = ex({ id: 1, name: 'Squat', muscles: ['Legs'] })
    const other = ex({ id: 2, name: 'Leg Press', muscles: ['Legs'] })

    const ranked = rankAlternatives(1, [current, other])

    expect(ranked.map((e) => e.id)).toEqual([2])
  })

  it('returns empty for an unknown current id', () => {
    expect(rankAlternatives(999, [ex({ id: 1, name: 'Squat', muscles: ['Legs'] })])).toEqual([])
  })

  it('returns empty when the current exercise has no primary-muscle data', () => {
    const current = ex({ id: 1, name: 'Mystery Movement', muscles: [] })
    const other = ex({ id: 2, name: 'Squat', muscles: ['Legs'] })

    expect(rankAlternatives(1, [current, other])).toEqual([])
  })

  it('caps at count and breaks ties alphabetically (deterministic rails)', () => {
    const current = ex({ id: 1, name: 'Bench', muscles: ['Chest'] })
    // Six identical-score candidates, shuffled names
    const names = ['Delta', 'Alpha', 'Echo', 'Charlie', 'Foxtrot', 'Bravo']
    const candidates = names.map((name, i) => ex({ id: 10 + i, name, muscles: ['Chest'] }))

    const ranked = rankAlternatives(1, [current, ...candidates], 5)

    expect(ranked.map((e) => e.name)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'])
  })
})

describe('isCompound', () => {
  it('is true at two or more distinct combined muscles, false below', () => {
    expect(isCompound(ex({ id: 1, name: 'Bench', muscles: ['Chest'], musclesSecondary: ['Triceps'] }))).toBe(true)
    expect(isCompound(ex({ id: 2, name: 'Curl', muscles: ['Biceps'] }))).toBe(false)
    expect(isCompound(ex({ id: 3, name: 'Unknown' }))).toBe(false)
  })

  it('deduplicates a muscle listed on both sides', () => {
    expect(isCompound(ex({ id: 1, name: 'X', muscles: ['Chest'], musclesSecondary: ['Chest'] }))).toBe(false)
  })
})
