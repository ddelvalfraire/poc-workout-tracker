import { describe, it, expect } from 'vitest'
import { HOME_SECTION_REGISTRY } from './registry'
import {
  DEFAULT_HOME_LAYOUT,
  resolveHomeLayout,
  parseHomeLayoutInput,
  moveSection,
  moveSectionToTop,
  reorderSection,
  toggleSection,
  setSectionSize,
  toLayoutDoc,
} from './layout'

const REGISTRY_KINDS = HOME_SECTION_REGISTRY.map((s) => s.kind)

describe('resolveHomeLayout', () => {
  it('degrades to the code-defined default when nothing is stored', () => {
    const resolved = resolveHomeLayout(null)
    expect(resolved.map((s) => s.kind)).toEqual(REGISTRY_KINDS)
    expect(resolved.every((s) => !s.hidden)).toBe(true)
  })

  it("gives every DEFAULT section its kind's registry defaultSize (the parity contract)", () => {
    const resolved = resolveHomeLayout(null)
    for (const section of resolved) {
      const meta = HOME_SECTION_REGISTRY.find((s) => s.kind === section.kind)
      expect(section.size).toBe(meta?.defaultSize)
    }
  })

  it('degrades to the default on a corrupt document', () => {
    for (const corrupt of ['garbage', 42, { sections: 'nope' }, { version: 2 }, []]) {
      expect(resolveHomeLayout(corrupt).map((s) => s.kind)).toEqual(REGISTRY_KINDS)
    }
  })

  it('degrades to the default on an unknown version', () => {
    const resolved = resolveHomeLayout({ version: 99, sections: [{ kind: 'momentum' }] })
    expect(resolved.map((s) => s.kind)).toEqual(REGISTRY_KINDS)
  })

  it('honors stored order and hidden flags', () => {
    const resolved = resolveHomeLayout({
      version: 3,
      sections: [
        { kind: 'unfinished' },
        { kind: 'momentum', hidden: true },
        { kind: 'today-recap' },
      ],
    })
    expect(resolved.map((s) => s.kind)).toEqual(['unfinished', 'momentum', 'today-recap'])
    expect(resolved.find((s) => s.kind === 'momentum')?.hidden).toBe(true)
    expect(resolved.find((s) => s.kind === 'unfinished')?.hidden).toBe(false)
  })

  it('keeps unknown kinds in place (render skips them, resolution round-trips them)', () => {
    const resolved = resolveHomeLayout({
      version: 3,
      sections: [{ kind: 'from-the-future' }, { kind: 'momentum' }],
    })
    expect(resolved[0]).toEqual({ id: 'from-the-future', kind: 'from-the-future', size: 'md', hidden: false })
  })

  it('appends registry kinds missing from the stored doc, visible, in registry order', () => {
    const resolved = resolveHomeLayout({
      version: 3,
      sections: [{ kind: 'unfinished', hidden: true }],
    })
    expect(resolved.map((s) => s.kind)).toEqual(['unfinished', 'momentum', 'today-recap'])
    expect(resolved.slice(1).every((s) => !s.hidden)).toBe(true)
  })

  it('drops duplicate kinds, keeping the first occurrence', () => {
    const resolved = resolveHomeLayout({
      version: 3,
      sections: [
        { kind: 'unfinished', hidden: true },
        { kind: 'unfinished' },
        { kind: 'momentum' },
        { kind: 'today-recap' },
      ],
    })
    expect(resolved.filter((s) => s.kind === 'unfinished')).toEqual([
      { id: 'unfinished', kind: 'unfinished', size: 'md', hidden: true },
    ])
  })

  it('honors a stored size the kind allows', () => {
    const resolved = resolveHomeLayout({
      version: 3,
      sections: [
        { kind: 'momentum', size: 'lg' },
        { kind: 'today-recap', size: 'sm' },
        { kind: 'unfinished' },
      ],
    })
    expect(resolved.map((s) => s.size)).toEqual(['lg', 'sm', 'md'])
  })

  it('normalizes an unknown, missing, or not-allowed size to the kind default', () => {
    const resolved = resolveHomeLayout({
      version: 3,
      sections: [
        { kind: 'momentum', size: 'xl' }, // unknown size value
        { kind: 'today-recap', size: 'lg' }, // not in today-recap's allowedSizes
        { kind: 'unfinished', size: 'sm' }, // unfinished is md-only
      ],
    })
    // Every surviving kind defaults to md, so normalization lands there in
    // all three cases; the per-kind lookup is still what produced it.
    expect(resolved.map((s) => s.size)).toEqual(['md', 'md', 'md'])
  })

  it('auto-upgrades a v1 document in memory: order and hidden survive, sizes are registry defaults', () => {
    const resolved = resolveHomeLayout({
      version: 1,
      sections: [
        { kind: 'unfinished' },
        { kind: 'momentum', hidden: true },
        { kind: 'today-recap' },
      ],
    })
    expect(resolved).toEqual([
      { id: 'unfinished', kind: 'unfinished', size: 'md', hidden: false },
      { id: 'momentum', kind: 'momentum', size: 'md', hidden: true },
      { id: 'today-recap', kind: 'today-recap', size: 'md', hidden: false },
    ])
  })

  it('a v1 document still gains newly shipped sections and sheds duplicates', () => {
    const resolved = resolveHomeLayout({
      version: 1,
      sections: [{ kind: 'unfinished', hidden: true }, { kind: 'unfinished' }],
    })
    expect(resolved.map((s) => s.kind)).toEqual(['unfinished', 'momentum', 'today-recap'])
    expect(resolved[0]).toEqual({ id: 'unfinished', kind: 'unfinished', size: 'md', hidden: true })
  })
})

describe('resolveHomeLayout identity (v3)', () => {
  it('upgrades a v2 document in memory: every id comes from its kind', () => {
    const resolved = resolveHomeLayout({
      version: 2,
      sections: [{ kind: 'unfinished' }, { kind: 'momentum', hidden: true }],
    })
    expect(resolved.map((s) => [s.id, s.kind])).toEqual([
      ['unfinished', 'unfinished'],
      ['momentum', 'momentum'],
      ['today-recap', 'today-recap'],
    ])
  })

  it('honors a stored id that differs from the kind', () => {
    const resolved = resolveHomeLayout({
      version: 3,
      sections: [{ kind: 'momentum', id: 'momentum-pinned' }],
    })
    expect(resolved[0]).toEqual({
      id: 'momentum-pinned',
      kind: 'momentum',
      size: 'md',
      hidden: false,
    })
  })

  it('drops a duplicate id, keeping the first occurrence', () => {
    const resolved = resolveHomeLayout({
      version: 3,
      sections: [
        { kind: 'momentum', hidden: true },
        { kind: 'momentum' },
      ],
    })
    expect(resolved.filter((s) => s.kind === 'momentum')).toEqual([
      { id: 'momentum', kind: 'momentum', size: 'md', hidden: true },
    ])
  })

  it('drops a repeated NON-repeatable kind even when the ids are distinct', () => {
    // Reads shrug rather than throw, but a corrupt document must not put two
    // Momentum panels on the page — nothing shipped today is `repeatable`.
    const resolved = resolveHomeLayout({
      version: 3,
      sections: [
        { kind: 'momentum' },
        { kind: 'momentum', id: 'momentum-2' },
      ],
    })
    expect(resolved.filter((s) => s.kind === 'momentum')).toHaveLength(1)
  })

  it('treats an empty stored id as absent rather than as an identity', () => {
    const resolved = resolveHomeLayout({
      version: 3,
      sections: [{ kind: 'momentum', id: '' }],
    })
    expect(resolved[0].id).toBe('momentum')
  })

  it('gives every section a unique id, always', () => {
    const ids = resolveHomeLayout(null).map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('parseHomeLayoutInput', () => {
  const valid = {
    version: 3,
    sections: [
      { kind: 'unfinished' },
      { kind: 'momentum', hidden: true },
      { kind: 'today-recap' },
    ],
  }

  it('accepts a complete valid document and normalizes hidden flags', () => {
    const doc = parseHomeLayoutInput(valid)
    expect(doc.version).toBe(3)
    expect(doc.sections).toEqual([
      { kind: 'unfinished' },
      { kind: 'momentum', hidden: true },
      { kind: 'today-recap' },
    ])
  })

  it('rejects a malformed document', () => {
    expect(() => parseHomeLayoutInput('garbage')).toThrow('invalid home layout')
    expect(() => parseHomeLayoutInput({ version: 99, sections: [] })).toThrow(
      'invalid home layout',
    )
  })

  it('rejects a v1 document at the write boundary (writes are always current-version)', () => {
    expect(() =>
      parseHomeLayoutInput({ version: 1, sections: valid.sections }),
    ).toThrow('invalid home layout')
  })

  it('rejects unknown kinds', () => {
    expect(() =>
      parseHomeLayoutInput({
        ...valid,
        sections: [...valid.sections, { kind: 'mystery' }],
      }),
    ).toThrow('unknown home section kind')
  })

  it('rejects a duplicate id', () => {
    expect(() =>
      parseHomeLayoutInput({
        ...valid,
        sections: [...valid.sections.slice(0, 2), { kind: 'unfinished' }],
      }),
    ).toThrow('duplicate home section id')
  })

  it('rejects a repeated non-repeatable kind even when the ids differ', () => {
    // Distinct ids clear the id rule, so this is the kind rule doing the work:
    // nothing shipped today is `repeatable`, so one Momentum is the maximum.
    expect(() =>
      parseHomeLayoutInput({
        ...valid,
        sections: [...valid.sections, { kind: 'momentum', id: 'momentum-2' }],
      }),
    ).toThrow('duplicate home section kind')
  })

  it('keeps an id that differs from the kind, and omits one that matches', () => {
    const doc = parseHomeLayoutInput({
      version: 3,
      sections: [
        { kind: 'momentum', id: 'momentum' },
        { kind: 'today-recap' },
        { kind: 'unfinished' },
      ],
    })
    // Every id here equals its kind, so the stored document carries none —
    // byte-identical to what v2 stored.
    expect(doc.sections).toEqual([
      { kind: 'momentum' },
      { kind: 'today-recap' },
      { kind: 'unfinished' },
    ])
  })

  it('rejects a document missing registry kinds', () => {
    expect(() =>
      parseHomeLayoutInput({ version: 3, sections: [{ kind: 'unfinished' }] }),
    ).toThrow('home layout must include every section')
  })

  it('accepts sizes the kind allows and omits a size equal to the default', () => {
    const doc = parseHomeLayoutInput({
      version: 3,
      sections: [
        { kind: 'momentum', size: 'sm' },
        { kind: 'today-recap', size: 'md' }, // default — serialized away
        { kind: 'unfinished', size: 'md' }, // default — serialized away
      ],
    })
    expect(doc.sections).toEqual([
      { kind: 'momentum', size: 'sm' },
      { kind: 'today-recap' },
      { kind: 'unfinished' },
    ])
  })

  it('rejects a size outside the kind allowedSizes (strict, unlike the read guard)', () => {
    const withSize = (kind: string, size: string) => ({
      version: 3,
      sections: valid.sections.map((s) => (s.kind === kind ? { ...s, size } : s)),
    })
    expect(() => parseHomeLayoutInput(withSize('today-recap', 'lg'))).toThrow(
      'invalid home section size',
    )
    expect(() => parseHomeLayoutInput(withSize('unfinished', 'sm'))).toThrow(
      'invalid home section size',
    )
    expect(() => parseHomeLayoutInput(withSize('momentum', 'xl'))).toThrow(
      'invalid home layout',
    )
  })
})

describe('moveSection', () => {
  const sections = resolveHomeLayout(null)

  it('swaps a section with its neighbor without mutating the input', () => {
    const next = moveSection(sections, 'today-recap', 'up')
    expect(next.map((s) => s.kind)).toEqual(['today-recap', 'momentum', 'unfinished'])
    expect(sections.map((s) => s.kind)).toEqual(REGISTRY_KINDS) // untouched
  })

  it('moves down past a neighbor', () => {
    const next = moveSection(sections, 'momentum', 'down')
    expect(next.map((s) => s.kind)).toEqual(['today-recap', 'momentum', 'unfinished'])
  })

  it('is a no-op at the edges and for unknown kinds', () => {
    expect(moveSection(sections, 'momentum', 'up')).toBe(sections)
    expect(moveSection(sections, 'unfinished', 'down')).toBe(sections)
    expect(moveSection(sections, 'nope', 'up')).toBe(sections)
  })
})

describe('moveSectionToTop', () => {
  const sections = resolveHomeLayout(null)

  it('moves a section to the front, preserving relative order, without mutating', () => {
    const next = moveSectionToTop(sections, 'unfinished')
    expect(next.map((s) => s.kind)).toEqual(['unfinished', 'momentum', 'today-recap'])
    expect(sections.map((s) => s.kind)).toEqual(REGISTRY_KINDS) // untouched
  })

  it('carries the moved section intact (size and hidden survive the move)', () => {
    const customized = toggleSection(setSectionSize(sections, 'momentum', 'sm'), 'momentum')
    const next = moveSectionToTop(customized, 'momentum')
    expect(next[0]).toEqual({ id: 'momentum', kind: 'momentum', size: 'sm', hidden: true })
  })

  it('is a no-op (same reference) when already first or for unknown kinds', () => {
    expect(moveSectionToTop(sections, 'momentum')).toBe(sections)
    expect(moveSectionToTop(sections, 'nope')).toBe(sections)
  })
})

describe('reorderSection', () => {
  const sections = resolveHomeLayout(null)

  it("moves the active section to the over section's slot, downward, without mutating", () => {
    const next = reorderSection(sections, 'momentum', 'unfinished')
    expect(next.map((s) => s.kind)).toEqual(['today-recap', 'unfinished', 'momentum'])
    expect(sections.map((s) => s.kind)).toEqual(REGISTRY_KINDS) // untouched
  })

  it("moves the active section to the over section's slot, upward", () => {
    const next = reorderSection(sections, 'unfinished', 'today-recap')
    expect(next.map((s) => s.kind)).toEqual(['momentum', 'unfinished', 'today-recap'])
  })

  it('is a no-op (same reference) for unknown kinds and self-targets', () => {
    expect(reorderSection(sections, 'nope', 'unfinished')).toBe(sections)
    expect(reorderSection(sections, 'unfinished', 'nope')).toBe(sections)
    expect(reorderSection(sections, 'unfinished', 'unfinished')).toBe(sections)
  })
})

describe('toggleSection', () => {
  const sections = resolveHomeLayout(null)

  it('flips hidden without mutating the input', () => {
    const next = toggleSection(sections, 'unfinished')
    expect(next.find((s) => s.kind === 'unfinished')?.hidden).toBe(true)
    expect(toggleSection(next, 'unfinished').find((s) => s.kind === 'unfinished')?.hidden).toBe(
      false,
    )
    expect(sections.find((s) => s.kind === 'unfinished')?.hidden).toBe(false)
  })

  it('is a no-op for unknown kinds', () => {
    expect(toggleSection(sections, 'nope')).toBe(sections)
  })
})

describe('setSectionSize', () => {
  const sections = resolveHomeLayout(null)

  it('sets an allowed size without mutating the input', () => {
    const next = setSectionSize(sections, 'momentum', 'sm')
    expect(next.find((s) => s.kind === 'momentum')?.size).toBe('sm')
    expect(sections.find((s) => s.kind === 'momentum')?.size).toBe('md')
  })

  it('is a no-op for unknown kinds, disallowed sizes, and the current size', () => {
    expect(setSectionSize(sections, 'nope', 'sm')).toBe(sections)
    expect(setSectionSize(sections, 'unfinished', 'sm')).toBe(sections)
    expect(setSectionSize(sections, 'today-recap', 'lg')).toBe(sections)
    expect(setSectionSize(sections, 'momentum', 'md')).toBe(sections)
  })
})

describe('toLayoutDoc', () => {
  it('serializes resolved sections into a version-2 document, omitting hidden:false and default sizes', () => {
    const doc = toLayoutDoc(
      setSectionSize(toggleSection(resolveHomeLayout(null), 'momentum'), 'today-recap', 'sm'),
    )
    expect(doc).toEqual({
      version: 3,
      sections: [
        { kind: 'momentum', hidden: true },
        { kind: 'today-recap', size: 'sm' },
        { kind: 'unfinished' },
      ],
    })
  })

  it('round-trips the default layout through parseHomeLayoutInput', () => {
    expect(() => parseHomeLayoutInput(toLayoutDoc(resolveHomeLayout(null)))).not.toThrow()
    expect(toLayoutDoc(resolveHomeLayout(null))).toEqual(DEFAULT_HOME_LAYOUT)
  })

  it('round-trips a non-default size through parse and resolve', () => {
    const doc = toLayoutDoc(setSectionSize(resolveHomeLayout(null), 'momentum', 'lg'))
    const resolved = resolveHomeLayout(parseHomeLayoutInput(doc))
    expect(resolved.find((s) => s.kind === 'momentum')?.size).toBe('lg')
  })
})
