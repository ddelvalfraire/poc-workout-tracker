import { describe, expect, test } from 'vitest'
import {
  defaultOvershootPolicy,
  overshootPolicySchema,
  resolveOvershootPolicy,
} from './overshoot-policy'

describe('overshootPolicySchema', () => {
  test('accepts the three policy values', () => {
    expect(overshootPolicySchema.parse('strict-load')).toBe('strict-load')
    expect(overshootPolicySchema.parse('e1rm-equivalent')).toBe('e1rm-equivalent')
    expect(overshootPolicySchema.parse('any-metric')).toBe('any-metric')
  })

  test('rejects anything outside the union', () => {
    expect(overshootPolicySchema.safeParse('lenient').success).toBe(false)
    expect(overshootPolicySchema.safeParse(1).success).toBe(false)
    expect(overshootPolicySchema.safeParse(null).success).toBe(false)
  })
})

describe('defaultOvershootPolicy', () => {
  test('load-anchored schemes default to strict-load', () => {
    for (const scheme of [
      'linear',
      'double-progression',
      'rep-progression',
      'percent-1rm',
      'amrap-cycle',
    ] as const) {
      expect(defaultOvershootPolicy(scheme)).toBe('strict-load')
    }
  })

  test('rpe-target defaults to e1rm-equivalent', () => {
    expect(defaultOvershootPolicy('rpe-target')).toBe('e1rm-equivalent')
  })

  test('weekly-volume is set-count scored — the policy is inert, default strict', () => {
    expect(defaultOvershootPolicy('weekly-volume')).toBe('strict-load')
  })

  test('no scheme defaults to strict-load', () => {
    expect(defaultOvershootPolicy(null)).toBe('strict-load')
  })
})

describe('resolveOvershootPolicy', () => {
  test('exercise override beats program policy beats scheme default', () => {
    expect(resolveOvershootPolicy('e1rm-equivalent', 'any-metric', 'linear')).toBe('any-metric')
    expect(resolveOvershootPolicy('e1rm-equivalent', null, 'linear')).toBe('e1rm-equivalent')
    expect(resolveOvershootPolicy(null, null, 'linear')).toBe('strict-load')
    expect(resolveOvershootPolicy(null, null, 'rpe-target')).toBe('e1rm-equivalent')
  })

  test('a program policy applies across schemes; the default only fills nulls', () => {
    expect(resolveOvershootPolicy('any-metric', null, 'rpe-target')).toBe('any-metric')
    expect(resolveOvershootPolicy('strict-load', null, 'rpe-target')).toBe('strict-load')
  })

  test('silence over corruption: invalid stored text degrades to the next layer', () => {
    expect(resolveOvershootPolicy('bogus', null, 'linear')).toBe('strict-load')
    expect(resolveOvershootPolicy('bogus', 'bogus', 'rpe-target')).toBe('e1rm-equivalent')
    expect(resolveOvershootPolicy('strict-load', 'bogus', 'rpe-target')).toBe('strict-load')
    expect(resolveOvershootPolicy(undefined, undefined, null)).toBe('strict-load')
  })
})
