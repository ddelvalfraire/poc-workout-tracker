import { describe, it, expect } from 'vitest'
import { HOME_SECTION_REGISTRY, type HomeSectionMeta } from './registry'
import {
  DEFAULT_HOME_LAYOUT,
  resolveHomeLayout,
  parseHomeLayoutInput,
  moveSection,
  moveSectionToTop,
  reorderSection,
  toggleSection,
  setSectionShape,
  setSectionConfig,
  addSection,
  removeSection,
  isExtraInstance,
  toLayoutDoc,
  type ResolvedHomeSection,
} from './layout'

const REGISTRY_KINDS = HOME_SECTION_REGISTRY.map((s) => s.kind)

/** The registry widened to its own interface. The `as const satisfies` literal
 *  type drops OPTIONAL fields from the entries that omit them, so reading
 *  `configKind` across every entry needs the declared shape — the same
 *  widening `REGISTRY_BY_KIND` does inside the module. */
const REGISTRY: readonly HomeSectionMeta[] = HOME_SECTION_REGISTRY

/** Registry order with two neighbours swapped — lets the move tests state
 *  what a move DOES without hard-coding how many kinds ship today. */
function swapped(a: number, b: number): string[] {
  const kinds = [...REGISTRY_KINDS]
  ;[kinds[a], kinds[b]] = [kinds[b], kinds[a]]
  return kinds
}

describe('resolveHomeLayout', () => {
  it('degrades to the code-defined default when nothing is stored', () => {
    const resolved = resolveHomeLayout(null)
    expect(resolved.map((s) => s.kind)).toEqual(REGISTRY_KINDS)
    expect(resolved.every((s) => !s.hidden)).toBe(true)
  })

  it("gives every DEFAULT section its kind's registry defaultShape (the parity contract)", () => {
    const resolved = resolveHomeLayout(null)
    for (const section of resolved) {
      const meta = HOME_SECTION_REGISTRY.find((s) => s.kind === section.kind)
      expect(section.shape).toBe(meta?.defaultShape)
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
    // Stored order leads; kinds the document didn't mention are appended.
    expect(resolved.map((s) => s.kind).slice(0, 3)).toEqual([
      'unfinished',
      'momentum',
      'today-recap',
    ])
    expect(resolved.map((s) => s.kind).sort()).toEqual([...REGISTRY_KINDS].sort())
    expect(resolved.find((s) => s.kind === 'momentum')?.hidden).toBe(true)
    expect(resolved.find((s) => s.kind === 'unfinished')?.hidden).toBe(false)
  })

  it('keeps unknown kinds in place (render skips them, resolution round-trips them)', () => {
    const resolved = resolveHomeLayout({
      version: 3,
      sections: [{ kind: 'from-the-future' }, { kind: 'momentum' }],
    })
    expect(resolved[0]).toEqual({ id: 'from-the-future', kind: 'from-the-future', shape: 'wide', hidden: false })
  })

  it('appends registry kinds missing from the stored doc, visible, in registry order', () => {
    const resolved = resolveHomeLayout({
      version: 3,
      sections: [{ kind: 'unfinished', hidden: true }],
    })
    expect(resolved[0].kind).toBe('unfinished')
    // Everything else in the registry follows, visible, in registry order.
    expect(resolved.slice(1).map((s) => s.kind)).toEqual(
      REGISTRY_KINDS.filter((k) => k !== 'unfinished'),
    )
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
      { id: 'unfinished', kind: 'unfinished', shape: 'wide', hidden: true },
    ])
  })

  it('honors a stored shape the kind allows', () => {
    const resolved = resolveHomeLayout({
      version: 3,
      sections: [
        { kind: 'momentum', shape: 'block' },
        { kind: 'today-recap', shape: 'micro' },
        { kind: 'unfinished' },
      ],
    })
    expect(resolved.map((s) => s.shape).slice(0, 3)).toEqual(['block', 'micro', 'wide'])
  })

  it('normalizes an unknown, missing, or not-allowed shape to the kind default', () => {
    const resolved = resolveHomeLayout({
      version: 3,
      sections: [
        { kind: 'momentum', shape: 'xl' }, // unknown shape value
        { kind: 'today-recap', shape: 'block' }, // not in today-recap's allowedShapes
        { kind: 'unfinished', shape: 'micro' }, // unfinished is md-only
      ],
    })
    // Every surviving kind defaults to md, so normalization lands there in
    // all three cases; the per-kind lookup is still what produced it.
    expect(resolved.map((s) => s.shape).slice(0, 3)).toEqual(['wide', 'wide', 'wide'])
  })

  it('auto-upgrades a v1 document in memory: order and hidden survive, shapes are registry defaults', () => {
    const resolved = resolveHomeLayout({
      version: 1,
      sections: [
        { kind: 'unfinished' },
        { kind: 'momentum', hidden: true },
        { kind: 'today-recap' },
      ],
    })
    expect(resolved.slice(0, 3)).toEqual([
      { id: 'unfinished', kind: 'unfinished', shape: 'wide', hidden: false },
      { id: 'momentum', kind: 'momentum', shape: 'wide', hidden: true },
      { id: 'today-recap', kind: 'today-recap', shape: 'wide', hidden: false },
    ])
  })

  it('a v1 document still gains newly shipped sections and sheds duplicates', () => {
    const resolved = resolveHomeLayout({
      version: 1,
      sections: [{ kind: 'unfinished', hidden: true }, { kind: 'unfinished' }],
    })
    expect(resolved.map((s) => s.kind).slice(0, 3)).toEqual([
      'unfinished',
      'momentum',
      'today-recap',
    ])
    expect(resolved[0]).toEqual({ id: 'unfinished', kind: 'unfinished', shape: 'wide', hidden: true })
  })
})

describe('resolveHomeLayout identity (v3)', () => {
  it('upgrades a v2 document in memory: every id comes from its kind', () => {
    const resolved = resolveHomeLayout({
      version: 2,
      sections: [{ kind: 'unfinished' }, { kind: 'momentum', hidden: true }],
    })
    expect(resolved.map((s) => [s.id, s.kind]).slice(0, 3)).toEqual([
      ['unfinished', 'unfinished'],
      ['momentum', 'momentum'],
      ['today-recap', 'today-recap'],
    ])
    // Every appended kind takes its id from its kind too.
    expect(resolved.every((s) => s.id === s.kind)).toBe(true)
  })

  it('honors a stored id that differs from the kind', () => {
    const resolved = resolveHomeLayout({
      version: 3,
      sections: [{ kind: 'momentum', id: 'momentum-pinned' }],
    })
    expect(resolved[0]).toEqual({
      id: 'momentum-pinned',
      kind: 'momentum',
      shape: 'wide',
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
      { id: 'momentum', kind: 'momentum', shape: 'wide', hidden: true },
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
  // Derived from the registry, not written out: a write must name every kind,
  // so a hand-listed fixture breaks every time a widget ships.
  const valid = {
    version: 3,
    sections: REGISTRY_KINDS.map((kind) =>
      kind === 'momentum' ? { kind, hidden: true } : { kind },
    ),
  }

  it('accepts a complete valid document and normalizes hidden flags', () => {
    const doc = parseHomeLayoutInput(valid)
    expect(doc.version).toBe(3)
    expect(doc.sections).toEqual(
      REGISTRY_KINDS.map((kind) => (kind === 'momentum' ? { kind, hidden: true } : { kind })),
    )
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
        sections: [...valid.sections, { kind: 'unfinished' }],
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
      sections: REGISTRY_KINDS.map((kind) => ({ kind, id: kind })),
    })
    // Every id here equals its kind, so the stored document carries none —
    // byte-identical to what v2 stored.
    expect(doc.sections).toEqual(REGISTRY_KINDS.map((kind) => ({ kind })))
  })

  it('rejects a document missing registry kinds', () => {
    expect(() =>
      parseHomeLayoutInput({ version: 3, sections: [{ kind: 'unfinished' }] }),
    ).toThrow('home layout must include every section')
  })

  it('accepts sizes the kind allows and omits a size equal to the default', () => {
    const doc = parseHomeLayoutInput({
      version: 3,
      sections: valid.sections.map((s) =>
        s.kind === 'momentum' ? { kind: 'momentum', shape: 'micro' } : { kind: s.kind },
      ),
    })
    expect(doc.sections).toEqual(
      REGISTRY_KINDS.map((kind) =>
        kind === 'momentum' ? { kind, shape: 'micro' } : { kind },
      ),
    )
  })

  it('rejects a shape outside the kind allowedShapes (strict, unlike the read guard)', () => {
    const withShape = (kind: string, shape: string) => ({
      version: 3,
      sections: valid.sections.map((s) => (s.kind === kind ? { ...s, shape } : s)),
    })
    expect(() => parseHomeLayoutInput(withShape('today-recap', 'block'))).toThrow(
      'invalid home section shape',
    )
    expect(() => parseHomeLayoutInput(withShape('unfinished', 'micro'))).toThrow(
      'invalid home section shape',
    )
    expect(() => parseHomeLayoutInput(withShape('momentum', 'xl'))).toThrow(
      'invalid home layout',
    )
  })
})

describe('moveSection', () => {
  const sections = resolveHomeLayout(null)

  it('swaps a section with its neighbor without mutating the input', () => {
    const next = moveSection(sections, 'today-recap', 'up')
    expect(next.map((s) => s.kind)).toEqual(swapped(0, 1))
    expect(sections.map((s) => s.kind)).toEqual(REGISTRY_KINDS) // untouched
  })

  it('moves down past a neighbor', () => {
    const next = moveSection(sections, 'momentum', 'down')
    expect(next.map((s) => s.kind)).toEqual(swapped(0, 1))
  })

  it('is a no-op at the edges and for unknown kinds', () => {
    expect(moveSection(sections, 'momentum', 'up')).toBe(sections)
    expect(moveSection(sections, REGISTRY_KINDS[REGISTRY_KINDS.length - 1], 'down')).toBe(sections)
    expect(moveSection(sections, 'nope', 'up')).toBe(sections)
  })
})

describe('moveSectionToTop', () => {
  const sections = resolveHomeLayout(null)

  it('moves a section to the front, preserving relative order, without mutating', () => {
    const next = moveSectionToTop(sections, 'unfinished')
    expect(next.map((s) => s.kind)).toEqual([
      'unfinished',
      ...REGISTRY_KINDS.filter((k) => k !== 'unfinished'),
    ])
    expect(sections.map((s) => s.kind)).toEqual(REGISTRY_KINDS) // untouched
  })

  it('carries the moved section intact (size and hidden survive the move)', () => {
    const customized = toggleSection(setSectionShape(sections, 'momentum', 'micro'), 'momentum')
    const next = moveSectionToTop(customized, 'momentum')
    expect(next[0]).toEqual({ id: 'momentum', kind: 'momentum', shape: 'micro', hidden: true })
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
    expect(next.map((s) => s.kind).slice(0, 3)).toEqual([
      'today-recap',
      'unfinished',
      'momentum',
    ])
    expect(sections.map((s) => s.kind)).toEqual(REGISTRY_KINDS) // untouched
  })

  it("moves the active section to the over section's slot, upward", () => {
    const next = reorderSection(sections, 'unfinished', 'today-recap')
    expect(next.map((s) => s.kind).slice(0, 3)).toEqual([
      'momentum',
      'unfinished',
      'today-recap',
    ])
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

describe('setSectionShape', () => {
  const sections = resolveHomeLayout(null)

  it('sets an allowed size without mutating the input', () => {
    const next = setSectionShape(sections, 'momentum', 'micro')
    expect(next.find((s) => s.kind === 'momentum')?.shape).toBe('micro')
    expect(sections.find((s) => s.kind === 'momentum')?.shape).toBe('wide')
  })

  it('is a no-op for unknown kinds, disallowed sizes, and the current size', () => {
    expect(setSectionShape(sections, 'nope', 'micro')).toBe(sections)
    expect(setSectionShape(sections, 'unfinished', 'micro')).toBe(sections)
    expect(setSectionShape(sections, 'today-recap', 'block')).toBe(sections)
    expect(setSectionShape(sections, 'momentum', 'wide')).toBe(sections)
  })
})

describe('toLayoutDoc', () => {
  it('serializes resolved sections into a current-version document, omitting hidden:false and default shapes', () => {
    const doc = toLayoutDoc(
      setSectionShape(toggleSection(resolveHomeLayout(null), 'momentum'), 'today-recap', 'micro'),
    )
    expect(doc).toEqual({
      version: 3,
      sections: REGISTRY_KINDS.map((kind) => {
        if (kind === 'momentum') return { kind, hidden: true }
        if (kind === 'today-recap') return { kind, shape: 'micro' }
        return { kind }
      }),
    })
  })

  it('round-trips the default layout through parseHomeLayoutInput', () => {
    expect(() => parseHomeLayoutInput(toLayoutDoc(resolveHomeLayout(null)))).not.toThrow()
    expect(toLayoutDoc(resolveHomeLayout(null))).toEqual(DEFAULT_HOME_LAYOUT)
  })

  it('round-trips a non-default size through parse and resolve', () => {
    const doc = toLayoutDoc(setSectionShape(resolveHomeLayout(null), 'momentum', 'block'))
    const resolved = resolveHomeLayout(parseHomeLayoutInput(doc))
    expect(resolved.find((s) => s.kind === 'momentum')?.shape).toBe('block')
  })
})

describe('addSection', () => {
  const REPEATABLE = REGISTRY.filter((m) => m.repeatable === true)
  const ONCE_ONLY = REGISTRY.filter((m) => m.repeatable !== true)

  it('unhides a once-only kind and moves it to the end', () => {
    for (const meta of ONCE_ONLY) {
      const hidden = toggleSection(resolveHomeLayout(null), meta.kind)
      const added = addSection(hidden, meta.kind)
      expect(added[added.length - 1].kind).toBe(meta.kind)
      expect(added[added.length - 1].hidden).toBe(false)
      // Adding must not duplicate a kind that may only appear once.
      expect(added.filter((s) => s.kind === meta.kind)).toHaveLength(1)
      expect(added).toHaveLength(hidden.length)
    }
  })

  it('leaves a once-only kind alone when it is already visible', () => {
    const sections = resolveHomeLayout(null)
    for (const meta of ONCE_ONLY) {
      expect(addSection(sections, meta.kind)).toBe(sections)
    }
  })

  it('reuses a HIDDEN instance of a repeatable kind rather than stranding it', () => {
    for (const meta of REPEATABLE) {
      const hidden = toggleSection(resolveHomeLayout(null), meta.kind)
      const added = addSection(hidden, meta.kind)
      // "Add this widget" means make one visible. Minting a second while the
      // first sat hidden would leave an invisible orphan behind.
      expect(added.filter((s) => s.kind === meta.kind)).toHaveLength(1)
      expect(added[added.length - 1].kind).toBe(meta.kind)
      expect(added[added.length - 1].hidden).toBe(false)
    }
  })

  it('gives a repeatable kind a new instance with its own id', () => {
    for (const meta of REPEATABLE) {
      const sections = resolveHomeLayout(null)
      const added = addSection(sections, meta.kind)
      const instances = added.filter((s) => s.kind === meta.kind)
      expect(instances).toHaveLength(2)
      expect(new Set(instances.map((s) => s.id)).size).toBe(2)
      expect(added[added.length - 1].kind).toBe(meta.kind)
      expect(added[added.length - 1].shape).toBe(meta.defaultShape)
    }
  })

  it('keeps handing out unused ids as instances pile up', () => {
    for (const meta of REPEATABLE) {
      let sections: readonly ResolvedHomeSection[] = resolveHomeLayout(null)
      for (let i = 0; i < 4; i++) sections = addSection(sections, meta.kind)
      const ids = sections.map((s) => s.id)
      expect(new Set(ids).size).toBe(ids.length)
      // Deterministic, so a server render and its hydration agree.
      expect(sections.filter((s) => s.kind === meta.kind).map((s) => s.id)).toEqual([
        meta.kind,
        `${meta.kind}:2`,
        `${meta.kind}:3`,
        `${meta.kind}:4`,
        `${meta.kind}:5`,
      ])
    }
  })

  it('ignores a kind the registry has never heard of', () => {
    const sections = resolveHomeLayout(null)
    expect(addSection(sections, 'from-the-future')).toBe(sections)
  })

  it('produces a layout the write boundary still accepts', () => {
    for (const meta of REPEATABLE) {
      const added = addSection(addSection(resolveHomeLayout(null), meta.kind), meta.kind)
      expect(() => parseHomeLayoutInput(toLayoutDoc(added))).not.toThrow()
      // And the extra instances survive the round trip, since a bare {kind}
      // row would collapse them back into one.
      expect(
        resolveHomeLayout(parseHomeLayoutInput(toLayoutDoc(added))).filter(
          (s) => s.kind === meta.kind,
        ),
      ).toHaveLength(3)
    }
  })
})

describe('removeSection', () => {
  const REPEATABLE = REGISTRY.filter((m) => m.repeatable === true)

  it('hides a kind that must stay in the document', () => {
    for (const meta of REGISTRY.filter((m) => m.repeatable !== true)) {
      const removed = removeSection(resolveHomeLayout(null), meta.kind)
      expect(removed.find((s) => s.id === meta.kind)?.hidden).toBe(true)
      // Hidden, never dropped: every document must still name every kind.
      expect(removed).toHaveLength(REGISTRY_KINDS.length)
      expect(() => parseHomeLayoutInput(toLayoutDoc(removed))).not.toThrow()
    }
  })

  it('deletes an EXTRA instance outright — it exists only because it was added', () => {
    for (const meta of REPEATABLE) {
      const added = addSection(resolveHomeLayout(null), meta.kind)
      const extra = added[added.length - 1]
      const removed = removeSection(added, extra.id)
      expect(removed.some((s) => s.id === extra.id)).toBe(false)
      expect(removed.filter((s) => s.kind === meta.kind)).toHaveLength(1)
    }
  })

  it('hides — never deletes — the LAST instance of a repeatable kind', () => {
    for (const meta of REPEATABLE) {
      const removed = removeSection(resolveHomeLayout(null), meta.kind)
      expect(removed.find((s) => s.id === meta.kind)?.hidden).toBe(true)
      expect(() => parseHomeLayoutInput(toLayoutDoc(removed))).not.toThrow()
    }
  })

  it('leaves unknown ids and already-hidden sections untouched, by reference', () => {
    const sections = resolveHomeLayout(null)
    expect(removeSection(sections, 'no-such-id')).toBe(sections)
    const hidden = removeSection(sections, REGISTRY_KINDS[0])
    expect(removeSection(hidden, REGISTRY_KINDS[0])).toBe(hidden)
  })

  it('agrees with isExtraInstance about what it is going to do', () => {
    // The editor labels the button from the predicate and the act reads the
    // same one, so a drift between "Remove" and "Hide" is impossible.
    for (const meta of REPEATABLE) {
      const one = resolveHomeLayout(null)
      expect(isExtraInstance(one, meta.kind)).toBe(false)
      expect(removeSection(one, meta.kind)).toHaveLength(one.length)

      const two = addSection(one, meta.kind)
      const extra = two[two.length - 1]
      expect(isExtraInstance(two, extra.id)).toBe(true)
      expect(removeSection(two, extra.id)).toHaveLength(two.length - 1)
    }
  })

  it('never calls a once-only kind an extra instance', () => {
    const sections = resolveHomeLayout(null)
    for (const meta of REGISTRY.filter((m) => m.repeatable !== true)) {
      expect(isExtraInstance(sections, meta.kind)).toBe(false)
    }
    expect(isExtraInstance(sections, 'no-such-id')).toBe(false)
  })
})

describe('per-instance config', () => {
  // Derived, never hand-listed: every rule below is stated in terms of what
  // the registry says a kind pins, so they keep holding as kinds are added.
  const PINNING = REGISTRY.filter((s) => s.configKind !== undefined)
  const NON_PINNING = REGISTRY.filter((s) => s.configKind === undefined)
  const EXERCISE = { source: 'wger', wgerExerciseId: 615 } as const

  /** A complete document — every registry kind present, as the write boundary
   *  demands — with one kind carrying the given config. */
  function docWith(kind: string, config: unknown) {
    return {
      version: 3,
      sections: REGISTRY_KINDS.map((k) => (k === kind ? { kind: k, config } : { kind: k })),
    }
  }

  it('drops config on kinds the registry says pin nothing', () => {
    for (const meta of NON_PINNING) {
      const resolved = resolveHomeLayout(docWith(meta.kind, { exercise: EXERCISE }))
      expect(resolved.find((s) => s.kind === meta.kind)?.config).toBeUndefined()
    }
  })

  it('rejects config on a non-pinning kind at the write boundary', () => {
    for (const meta of NON_PINNING) {
      expect(() => parseHomeLayoutInput(docWith(meta.kind, { exercise: EXERCISE }))).toThrow(
        /unexpected home section config/,
      )
    }
  })

  it('keeps a config the registry does accept, through resolve and serialize', () => {
    for (const meta of PINNING) {
      const resolved = resolveHomeLayout(docWith(meta.kind, { exercise: EXERCISE }))
      expect(resolved.find((s) => s.kind === meta.kind)?.config).toEqual({ exercise: EXERCISE })
      expect(toLayoutDoc(resolved).sections).toContainEqual({
        kind: meta.kind,
        config: { exercise: EXERCISE },
      })
    }
  })

  it("round-trips an unknown client's pinned section rather than stripping it", () => {
    const resolved = resolveHomeLayout({
      version: 3,
      sections: [{ kind: 'from-the-future', config: { exercise: EXERCISE } }],
    })
    expect(resolved.find((s) => s.kind === 'from-the-future')?.config).toEqual({
      exercise: EXERCISE,
    })
  })

  it('drops a malformed config instead of failing the document', () => {
    for (const bad of ['nope', 42, { exercise: { source: 'wger' } }, { exercise: null }]) {
      const resolved = resolveHomeLayout({
        version: 3,
        sections: [{ kind: 'from-the-future', config: bad }],
      })
      // The section survives; only its unreadable config is dropped.
      expect(resolved.map((s) => s.kind)).toContain('from-the-future')
      expect(resolved.find((s) => s.kind === 'from-the-future')?.config).toBeUndefined()
    }
  })

  it('keeps the default document byte-identical — config adds nothing when nothing is pinned', () => {
    expect(toLayoutDoc(resolveHomeLayout(null))).toEqual(DEFAULT_HOME_LAYOUT)
    expect(JSON.stringify(DEFAULT_HOME_LAYOUT)).not.toContain('config')
  })
})

describe('setSectionConfig', () => {
  const EXERCISE = { source: 'wger', wgerExerciseId: 73 } as const

  it('leaves kinds that pin nothing untouched, by reference', () => {
    const sections = resolveHomeLayout(null)
    for (const meta of REGISTRY) {
      if (meta.configKind !== undefined) continue
      expect(setSectionConfig(sections, meta.kind, { exercise: EXERCISE })).toBe(sections)
    }
  })

  it('leaves an unknown id untouched, by reference', () => {
    const sections = resolveHomeLayout(null)
    expect(setSectionConfig(sections, 'no-such-id', { exercise: EXERCISE })).toBe(sections)
  })

  it('pins and unpins a kind that accepts config', () => {
    for (const meta of REGISTRY) {
      if (meta.configKind === undefined) continue
      const sections = resolveHomeLayout(null)
      const pinned = setSectionConfig(sections, meta.kind, { exercise: EXERCISE })
      expect(pinned.find((s) => s.id === meta.kind)?.config).toEqual({ exercise: EXERCISE })
      const unpinned = setSectionConfig(pinned, meta.kind, undefined)
      // Unpinning must ERASE the key, not leave an empty object behind, or the
      // default document stops round-tripping byte-equal.
      expect(Object.hasOwn(unpinned.find((s) => s.id === meta.kind)!, 'config')).toBe(false)
    }
  })
})
