import { describe, expect, test } from 'vitest'
import { createTranslator } from 'next-intl'

import en from '../../../../messages/en.json'
import { renderStaticIntl } from '../../../../vitest.intl'
import type { Progression } from '@/lib/program-input'
import {
  schemeSentence,
  type ProgressionScheme,
  type SchemeSentenceContext,
} from '@/lib/scheme-copy'

import { SchemeSubtitle } from './scheme-subtitle'

const ALL_SCHEMES: ProgressionScheme[] = [
  'linear',
  'double-progression',
  'percent-1rm',
  'rpe-target',
  'weekly-volume',
  'rep-progression',
  'amrap-cycle',
]

describe('SchemeSubtitle (#228 — builder scheme line)', () => {
  test('renders the human name plus the plain one-liner, muted', () => {
    const html = renderStaticIntl(<SchemeSubtitle scheme="double-progression" />)
    expect(html).toContain('Double progression')
    expect(html).toContain(
      'Work up to the top of your rep range, then the weight goes up and reps start over.',
    )
    expect(html).toContain('text-muted-foreground')
    expect(html).not.toMatch(/SchemeSubtitle\.[a-zA-Z.]+/)
  })

  test('never prints the technical scheme id', () => {
    const html = renderStaticIntl(<SchemeSubtitle scheme="percent-1rm" />)
    expect(html).not.toContain('percent-1rm')
    expect(html).toContain('Percent of 1RM')
  })

  test('every scheme resolves a name and a one-liner, with no key path left', () => {
    for (const scheme of ALL_SCHEMES) {
      const html = renderStaticIntl(<SchemeSubtitle scheme={scheme} />)
      expect(html, scheme).not.toMatch(/SchemeCopy\.[a-zA-Z.]+/)
      expect(html, scheme).not.toMatch(/SchemeSubtitle\.[a-zA-Z.]+/)
    }
  })
})

/**
 * The #228 voice, word for word, now that the sentences live in the catalog
 * rather than in the module. This is the ONLY place the English is asserted;
 * lib/scheme-copy.test.ts asserts which branch fires and with what numbers.
 */
describe('SchemeCopy voice, rendered from schemeSentence descriptors', () => {
  const t = createTranslator({ locale: 'en', messages: en, namespace: 'SchemeCopy' })
  const say = (progression: Progression, context: SchemeSentenceContext) => {
    const message = schemeSentence(progression, context)
    return t(message.key as never, message.values as never)
  }

  test('the picker one-liners survive the move to the catalog', () => {
    expect(t('subtitle.doubleProgression')).toBe(
      'Work up to the top of your rep range, then the weight goes up and reps start over.',
    )
    expect(t('subtitle.linear')).toBe('Add weight every session you complete all sets.')
    expect(t('subtitle.repProgression')).toBe('Same weight, more reps each session.')
  })

  test("the conditional sentences carry the lifter's actual numbers", () => {
    expect(say({ scheme: 'linear', incrementKg: 2.27 }, { unit: 'lb' })).toBe(
      'Complete all sets → +5 lb next session.',
    )
    expect(
      say(
        { scheme: 'double-progression', repMin: 8, repMax: 12, incrementKg: 2.27 },
        { unit: 'lb', currentLoadKg: 29.48 },
      ),
    ).toBe('Hit 12 reps on every set at 65 lb → +5 lb next session.')
    expect(
      say({ scheme: 'double-progression', repMin: 8, repMax: 12, incrementKg: 2.5 }, { unit: 'kg' }),
    ).toBe('Hit 12 reps on every set → +2.5 kg next session.')
    expect(
      say(
        { scheme: 'percent-1rm', trainingMaxKg: 63.5, weekPercents: [0.7, 0.8, 0.9] },
        { unit: 'lb' },
      ),
    ).toBe('Week loads are 70–90% of your 140 lb training max.')
    expect(
      say({ scheme: 'percent-1rm', trainingMaxKg: 100, weekPercents: [0.75] }, { unit: 'kg' }),
    ).toBe('Week loads are 75% of your 100 kg training max.')
    expect(say({ scheme: 'rpe-target', targetRpe: 8 }, { unit: 'lb' })).toBe(
      'Loads picked from your estimated max to land at RPE 8.',
    )
    expect(say({ scheme: 'weekly-volume', mevSets: 12, mrvSets: 20 }, { unit: 'lb' })).toBe(
      '12 → 20 sets across the block, added weekly.',
    )
    expect(
      say(
        { scheme: 'amrap-cycle', trainingMaxKg: 100, incrementKg: 2.5, wave: [[0.65]] },
        { unit: 'kg' },
      ),
    ).toBe('Beat your rep record on the last set to earn the next training-max bump (+2.5 kg).')
  })

  test('rep progression inflects one rep against many, capped and not', () => {
    expect(
      say(
        { scheme: 'rep-progression', incrementReps: 1, incrementSec: 0, maxReps: 20 },
        { unit: 'lb' },
      ),
    ).toBe('+1 rep each session, up to 20.')
    expect(
      say({ scheme: 'rep-progression', incrementReps: 2, incrementSec: 0 }, { unit: 'kg' }),
    ).toBe('+2 reps each session.')
    expect(
      say({ scheme: 'rep-progression', incrementReps: 0, incrementSec: 30 }, { unit: 'kg' }),
    ).toBe('+30 sec each session.')
  })

  test('a micro-increment prints its exact converted value, not the grid floor', () => {
    expect(say({ scheme: 'linear', incrementKg: 0.5 }, { unit: 'lb' })).toBe(
      'Complete all sets → +1.1 lb next session.',
    )
  })

  test('a degraded config renders the subtitle, never undefined or a key path', () => {
    const rendered = say({ scheme: 'linear', incrementKg: 0 }, { unit: 'lb' })
    expect(rendered).toBe('Add weight every session you complete all sets.')
    expect(rendered).not.toMatch(/SchemeCopy\.[a-zA-Z.]+/)
  })
})
