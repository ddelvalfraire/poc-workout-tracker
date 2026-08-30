import { describe, it, expect } from 'vitest'
import type { MappedTemplate } from './wger-template-map'
import {
  dayNameChips,
  findAdoptedProgram,
  groupByDaysPerWeek,
  type ShelfCard,
} from './wger-template-shelf'

/** A minimal honest mapped card: real day/exercise shapes, no casts. */
function card(wgerId: number, dayNames: string[]): ShelfCard {
  return {
    wgerId,
    mapped: {
      input: {
        name: `Template ${wgerId}`,
        sourceUrl: `https://wger.de/en/routine/${wgerId}/view`,
        days: dayNames.map((name) => ({
          name,
          exercises: [{ wgerExerciseId: 1, name: 'Bench Press', sets: [{}] }],
        })),
      },
      skipped: [],
    },
  }
}

describe('groupByDaysPerWeek', () => {
  it('zones cards by training days, fewest first, keeping incoming order within a zone', () => {
    const cards = [
      card(1, ['Push', 'Pull', 'Legs']),
      card(2, ['Full A', 'Full B', 'Full C', 'Full D']),
      card(3, ['Upper', 'Lower', 'Arms']),
    ]

    const groups = groupByDaysPerWeek(cards)

    expect(groups.map((g) => g.label)).toEqual(['3-DAY', '4-DAY'])
    expect(groups[0].cards.map((c) => c.wgerId)).toEqual([1, 3])
    expect(groups[1].cards.map((c) => c.wgerId)).toEqual([2])
  })

  it('returns nothing for no cards', () => {
    expect(groupByDaysPerWeek([])).toEqual([])
  })
})

describe('dayNameChips', () => {
  it('reads the day names already in memory', () => {
    expect(dayNameChips(card(1, ['Push', 'Pull', 'Legs']).mapped.input)).toEqual([
      'Push',
      'Pull',
      'Legs',
    ])
  })

  it('drops blank names instead of rendering empty pills', () => {
    expect(dayNameChips(card(1, ['Push', '  ']).mapped.input)).toEqual(['Push'])
  })
})

describe('findAdoptedProgram (sourceUrl provenance)', () => {
  const programs = [
    { id: 'p-other', sourceUrl: null },
    { id: 'p-adopted', sourceUrl: 'https://wger.de/en/routine/7/view' },
  ]

  it('matches a user program by the stored attribution URL', () => {
    const adopted = findAdoptedProgram(programs, 'https://wger.de/en/routine/7/view')
    expect(adopted?.id).toBe('p-adopted')
  })

  it('never fakes a match: unknown URL, non-string, or empty → null', () => {
    expect(findAdoptedProgram(programs, 'https://wger.de/en/routine/8/view')).toBeNull()
    expect(findAdoptedProgram(programs, undefined)).toBeNull()
    expect(findAdoptedProgram(programs, '')).toBeNull()
  })
})

// Keeps the fixture honest against the real MappedTemplate type.
const typeCheck: MappedTemplate = card(1, ['Push']).mapped
void typeCheck
