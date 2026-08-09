import { describe, it, expect } from 'vitest'
import { HOME_SECTION_REGISTRY } from './registry'
import {
  DEFAULT_HOME_LAYOUT,
  resolveHomeLayout,
  parseHomeLayoutInput,
  moveSection,
  toggleSection,
  toLayoutDoc,
} from './layout'

const REGISTRY_KINDS = HOME_SECTION_REGISTRY.map((s) => s.kind)

describe('resolveHomeLayout', () => {
  it('degrades to the code-defined default when nothing is stored', () => {
    const resolved = resolveHomeLayout(null)
    expect(resolved.map((s) => s.kind)).toEqual(REGISTRY_KINDS)
    expect(resolved.every((s) => !s.hidden)).toBe(true)
  })

  it('degrades to the default on a corrupt document', () => {
    for (const corrupt of ['garbage', 42, { sections: 'nope' }, { version: 1 }, []]) {
      expect(resolveHomeLayout(corrupt).map((s) => s.kind)).toEqual(REGISTRY_KINDS)
    }
  })

  it('degrades to the default on an unknown version', () => {
    const resolved = resolveHomeLayout({ version: 2, sections: [{ kind: 'history' }] })
    expect(resolved.map((s) => s.kind)).toEqual(REGISTRY_KINDS)
  })

  it('honors stored order and hidden flags', () => {
    const resolved = resolveHomeLayout({
      version: 1,
      sections: [
        { kind: 'history' },
        { kind: 'momentum', hidden: true },
        { kind: 'today-recap' },
        { kind: 'unfinished' },
      ],
    })
    expect(resolved.map((s) => s.kind)).toEqual([
      'history',
      'momentum',
      'today-recap',
      'unfinished',
    ])
    expect(resolved.find((s) => s.kind === 'momentum')?.hidden).toBe(true)
    expect(resolved.find((s) => s.kind === 'history')?.hidden).toBe(false)
  })

  it('keeps unknown kinds in place (render skips them, resolution round-trips them)', () => {
    const resolved = resolveHomeLayout({
      version: 1,
      sections: [{ kind: 'from-the-future' }, { kind: 'history' }],
    })
    expect(resolved[0]).toEqual({ kind: 'from-the-future', hidden: false })
  })

  it('appends registry kinds missing from the stored doc, visible, in registry order', () => {
    const resolved = resolveHomeLayout({
      version: 1,
      sections: [{ kind: 'history', hidden: true }],
    })
    expect(resolved.map((s) => s.kind)).toEqual([
      'history',
      'momentum',
      'today-recap',
      'unfinished',
    ])
    expect(resolved.slice(1).every((s) => !s.hidden)).toBe(true)
  })

  it('drops duplicate kinds, keeping the first occurrence', () => {
    const resolved = resolveHomeLayout({
      version: 1,
      sections: [
        { kind: 'history', hidden: true },
        { kind: 'history' },
        { kind: 'momentum' },
        { kind: 'today-recap' },
        { kind: 'unfinished' },
      ],
    })
    expect(resolved.filter((s) => s.kind === 'history')).toEqual([
      { kind: 'history', hidden: true },
    ])
  })
})

describe('parseHomeLayoutInput', () => {
  const valid = {
    version: 1,
    sections: [
      { kind: 'history' },
      { kind: 'momentum', hidden: true },
      { kind: 'today-recap' },
      { kind: 'unfinished' },
    ],
  }

  it('accepts a complete valid document and normalizes hidden flags', () => {
    const doc = parseHomeLayoutInput(valid)
    expect(doc.version).toBe(1)
    expect(doc.sections).toEqual([
      { kind: 'history' },
      { kind: 'momentum', hidden: true },
      { kind: 'today-recap' },
      { kind: 'unfinished' },
    ])
  })

  it('rejects a malformed document', () => {
    expect(() => parseHomeLayoutInput('garbage')).toThrow('invalid home layout')
    expect(() => parseHomeLayoutInput({ version: 2, sections: [] })).toThrow(
      'invalid home layout',
    )
  })

  it('rejects unknown kinds', () => {
    expect(() =>
      parseHomeLayoutInput({
        ...valid,
        sections: [...valid.sections, { kind: 'mystery' }],
      }),
    ).toThrow('unknown home section kind')
  })

  it('rejects duplicate kinds', () => {
    expect(() =>
      parseHomeLayoutInput({
        ...valid,
        sections: [...valid.sections.slice(0, 3), { kind: 'history' }],
      }),
    ).toThrow('duplicate home section kind')
  })

  it('rejects a document missing registry kinds', () => {
    expect(() =>
      parseHomeLayoutInput({ version: 1, sections: [{ kind: 'history' }] }),
    ).toThrow('home layout must include every section')
  })
})

describe('moveSection', () => {
  const sections = resolveHomeLayout(null)

  it('swaps a section with its neighbor without mutating the input', () => {
    const next = moveSection(sections, 'today-recap', 'up')
    expect(next.map((s) => s.kind)).toEqual([
      'today-recap',
      'momentum',
      'unfinished',
      'history',
    ])
    expect(sections.map((s) => s.kind)).toEqual(REGISTRY_KINDS) // untouched
  })

  it('moves down past a neighbor', () => {
    const next = moveSection(sections, 'momentum', 'down')
    expect(next.map((s) => s.kind)).toEqual([
      'today-recap',
      'momentum',
      'unfinished',
      'history',
    ])
  })

  it('is a no-op at the edges and for unknown kinds', () => {
    expect(moveSection(sections, 'momentum', 'up')).toBe(sections)
    expect(moveSection(sections, 'history', 'down')).toBe(sections)
    expect(moveSection(sections, 'nope', 'up')).toBe(sections)
  })
})

describe('toggleSection', () => {
  const sections = resolveHomeLayout(null)

  it('flips hidden without mutating the input', () => {
    const next = toggleSection(sections, 'history')
    expect(next.find((s) => s.kind === 'history')?.hidden).toBe(true)
    expect(toggleSection(next, 'history').find((s) => s.kind === 'history')?.hidden).toBe(
      false,
    )
    expect(sections.find((s) => s.kind === 'history')?.hidden).toBe(false)
  })

  it('is a no-op for unknown kinds', () => {
    expect(toggleSection(sections, 'nope')).toBe(sections)
  })
})

describe('toLayoutDoc', () => {
  it('serializes resolved sections into a version-1 document, omitting hidden:false', () => {
    const doc = toLayoutDoc(toggleSection(resolveHomeLayout(null), 'momentum'))
    expect(doc).toEqual({
      version: 1,
      sections: [
        { kind: 'momentum', hidden: true },
        { kind: 'today-recap' },
        { kind: 'unfinished' },
        { kind: 'history' },
      ],
    })
  })

  it('round-trips the default layout through parseHomeLayoutInput', () => {
    expect(() => parseHomeLayoutInput(toLayoutDoc(resolveHomeLayout(null)))).not.toThrow()
    expect(toLayoutDoc(resolveHomeLayout(null))).toEqual(DEFAULT_HOME_LAYOUT)
  })
})
