import { describe, it, expect } from 'vitest'
import {
  candidateKeys,
  guessCategory,
  matchExercises,
  MAX_CUSTOM_CREATES,
  type CatalogEntry,
} from './match'

const CATALOG: CatalogEntry[] = [
  { source: 'wger', id: 73, name: 'Bench Press' },
  { source: 'wger', id: 111, name: 'Barbell Bench Press' },
  { source: 'wger', id: 191, name: 'Squat' },
  { source: 'wger', id: 205, name: 'Lat Pulldown' },
  { source: 'custom', id: 3, name: 'Sled Push' },
]

describe('candidateKeys', () => {
  it('normalizes case, punctuation, and whitespace', () => {
    expect(candidateKeys('  Chin-Up ')).toEqual(['chin up'])
  })

  it('moves parenthetical qualifiers to the front and offers the base last', () => {
    expect(candidateKeys('Bench Press (Barbell)')).toEqual([
      'bench press barbell',
      'barbell bench press',
      'bench press',
    ])
  })
})

describe('matchExercises', () => {
  it('matches an exact normalized name', () => {
    const resolutions = matchExercises(['bench  press'], CATALOG)
    expect(resolutions.get('bench  press')).toEqual({
      kind: 'match',
      source: 'wger',
      id: 73,
      name: 'Bench Press',
    })
  })

  it('matches via the qualifier-first rearrangement before falling back', () => {
    // "Bench Press (Barbell)" must land on "Barbell Bench Press" (rearranged
    // key), which outranks the loose base-name fall-through to "Bench Press".
    const resolutions = matchExercises(['Bench Press (Barbell)'], CATALOG)
    expect(resolutions.get('Bench Press (Barbell)')).toMatchObject({ kind: 'match', id: 111 })
  })

  it('matches user customs, and lets a custom win a name collision with wger', () => {
    const withShadow: CatalogEntry[] = [...CATALOG, { source: 'custom', id: 9, name: 'Squat' }]
    const resolutions = matchExercises(['Sled Push', 'Squat'], withShadow)
    expect(resolutions.get('Sled Push')).toMatchObject({ kind: 'match', source: 'custom', id: 3 })
    expect(resolutions.get('Squat')).toMatchObject({ kind: 'match', source: 'custom', id: 9 })
  })

  it('resolves curated aliases against the live catalog', () => {
    const resolutions = matchExercises(['Lat Pulldown (Cable)'], CATALOG)
    expect(resolutions.get('Lat Pulldown (Cable)')).toMatchObject({ kind: 'match', id: 205 })
  })

  it('degrades a stale alias (target not in catalog) to create, never a wrong match', () => {
    // 'front squat barbell' aliases to 'Front Squat', absent from this catalog.
    const resolutions = matchExercises(['Front Squat (Barbell)'], [])
    expect(resolutions.get('Front Squat (Barbell)')).toEqual({ kind: 'create' })
  })

  it('returns create for unmatched names', () => {
    const resolutions = matchExercises(['Nordic Curl (Homemade Rig)'], CATALOG)
    expect(resolutions.get('Nordic Curl (Homemade Rig)')).toEqual({ kind: 'create' })
  })

  it('exposes the cap constant the planner enforces', () => {
    expect(MAX_CUSTOM_CREATES).toBe(100)
  })
})

describe('guessCategory', () => {
  it('guesses from movement keywords', () => {
    expect(guessCategory('Standing Calf Raise (Machine)')).toBe('Calves')
    expect(guessCategory('Hack Squat')).toBe('Legs')
    expect(guessCategory('Cable Crunch')).toBe('Abs')
    expect(guessCategory('Zottman Curl')).toBe('Arms')
    expect(guessCategory('Arnold Shoulder Press')).toBe('Shoulders')
    expect(guessCategory('Pendlay Row')).toBe('Back')
    expect(guessCategory('Assault Bike')).toBe('Cardio')
  })

  it('falls back to Chest for unknowns (documented arbitrary default)', () => {
    expect(guessCategory('Mystery Movement')).toBe('Chest')
  })
})
