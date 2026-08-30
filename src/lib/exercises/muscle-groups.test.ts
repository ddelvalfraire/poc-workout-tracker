import { describe, it, expect } from 'vitest'
import { MUSCLE_GROUPS, muscleGroupFor } from './muscle-groups'

describe('muscleGroupFor', () => {
  it('maps every catalog muscle name to its bucket', () => {
    // The full set mapMuscleNames can emit (name_en, Latin fallback for rows
    // with empty name_en) — pinned so wger catalog drift fails loudly here.
    const expected: Record<string, string> = {
      Chest: 'Chest',
      'Serratus anterior': 'Chest',
      Lats: 'Back',
      Trapezius: 'Back',
      Shoulders: 'Shoulders',
      Biceps: 'Biceps',
      Brachialis: 'Biceps',
      Triceps: 'Triceps',
      Quads: 'Quads',
      Hamstrings: 'Hamstrings',
      Glutes: 'Glutes',
      Calves: 'Calves',
      Soleus: 'Calves',
      Abs: 'Core',
      'Obliquus externus abdominis': 'Core',
    }
    for (const [name, group] of Object.entries(expected)) {
      expect(muscleGroupFor(name), name).toBe(group)
    }
  })

  it('returns null for unrecognized names (callers route these to Other)', () => {
    expect(muscleGroupFor('Forearms')).toBeNull()
    expect(muscleGroupFor('chest')).toBeNull() // case-sensitive by design
    expect(muscleGroupFor('')).toBeNull()
  })

  it('keeps the display order stable', () => {
    expect(MUSCLE_GROUPS).toEqual([
      'Chest',
      'Back',
      'Shoulders',
      'Biceps',
      'Triceps',
      'Quads',
      'Hamstrings',
      'Glutes',
      'Calves',
      'Core',
    ])
  })
})
