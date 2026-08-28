import { describe, it, expect } from 'vitest'
import { HOME_SECTION_REGISTRY, type HomeSectionMeta } from './registry'
import { parseHomeLayoutInput, resolveHomeLayout, toLayoutDoc } from './layout'
import { applyPreset, findPreset, HOME_PRESETS, GENERAL_PRESET_ID, matchPreset } from './presets'

/** Widened to the declared interface — the registry's `as const satisfies`
 *  literal type drops optional fields from the entries that omit them. */
const REGISTRY: readonly HomeSectionMeta[] = HOME_SECTION_REGISTRY
const REGISTRY_KINDS = REGISTRY.map((m) => m.kind)
const META = new Map(REGISTRY.map((m) => [m.kind, m]))

describe('the preset table', () => {
  it('ships the seven named layouts, with unique ids', () => {
    const ids = HOME_PRESETS.map((p) => p.id)
    expect(ids).toEqual([
      'cut',
      'bulk',
      'powerlifting',
      'hypertrophy',
      'conditioning',
      'consistency',
      'volume',
    ])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('names a general preset that actually exists', () => {
    expect(findPreset(GENERAL_PRESET_ID)).toBeDefined()
  })

  it('only ever names shapes the registry allows for that kind', () => {
    for (const preset of HOME_PRESETS) {
      for (const section of preset.sections) {
        const meta = META.get(section.kind)
        expect(meta).toBeDefined()
        if (section.shape === undefined) continue
        // A shape outside allowedShapes is not an error anyone would SEE —
        // resolution silently normalizes it to the kind's default — so the
        // preset would quietly render as something other than what it says.
        expect(meta!.allowedShapes).toContain(section.shape)
      }
    }
  })

  it('never names a kind twice in one preset', () => {
    for (const preset of HOME_PRESETS) {
      const kinds = preset.sections.map((s) => s.kind)
      expect(new Set(kinds).size).toBe(kinds.length)
    }
  })

  it('gives every preset AT MOST ONE anchor — two focal points is a card wall', () => {
    for (const preset of HOME_PRESETS) {
      const anchors = preset.sections.filter((s) => s.shape === 'block' || s.shape === 'hero')
      expect(anchors.length).toBeLessThanOrEqual(1)
    }
  })

  it('gives every preset AT LEAST ONE tall cell — the vertical break', () => {
    for (const preset of HOME_PRESETS) {
      expect(preset.sections.some((s) => s.shape === 'tall')).toBe(true)
    }
  })

  it('shows enough to be a home, without showing everything', () => {
    for (const preset of HOME_PRESETS) {
      expect(preset.sections.length).toBeGreaterThanOrEqual(4)
      // A preset that reveals the whole catalog is not a preset.
      expect(preset.sections.length).toBeLessThan(REGISTRY_KINDS.length)
    }
  })
})

describe('applyPreset', () => {
  it('puts the named sections first, in the preset order, all visible', () => {
    for (const preset of HOME_PRESETS) {
      const applied = applyPreset(preset.id)
      const visible = applied.filter((s) => !s.hidden)
      expect(visible.map((s) => s.kind)).toEqual(preset.sections.map((s) => s.kind))
      // Order is not merely "contains": the packer places in document order,
      // so a preset resolving out of order is a different home.
      expect(applied.slice(0, visible.length)).toEqual(visible)
    }
  })

  it('gives every named section the shape the preset asked for', () => {
    for (const preset of HOME_PRESETS) {
      const applied = applyPreset(preset.id)
      for (const section of preset.sections) {
        const resolved = applied.find((s) => s.kind === section.kind)
        expect(resolved).toBeDefined()
        expect(resolved!.shape).toBe(section.shape ?? META.get(section.kind)!.defaultShape)
      }
    }
  })

  it('appends every unnamed registry kind, hidden — the document stays complete', () => {
    for (const preset of HOME_PRESETS) {
      const applied = applyPreset(preset.id)
      expect(new Set(applied.map((s) => s.kind))).toEqual(new Set(REGISTRY_KINDS))
      const named = new Set<string>(preset.sections.map((s) => s.kind))
      for (const section of applied) {
        expect(section.hidden).toBe(!named.has(section.kind))
      }
    }
  })

  it('gives a repeatable kind exactly one instance', () => {
    for (const preset of HOME_PRESETS) {
      const kinds = applyPreset(preset.id).map((s) => s.kind)
      expect(new Set(kinds).size).toBe(kinds.length)
    }
  })

  it('produces unique ids that survive the write boundary', () => {
    for (const preset of HOME_PRESETS) {
      const applied = applyPreset(preset.id)
      const ids = applied.map((s) => s.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(() => parseHomeLayoutInput(toLayoutDoc(applied))).not.toThrow()
    }
  })

  it('round-trips through storage unchanged — a preset IS an ordinary document', () => {
    for (const preset of HOME_PRESETS) {
      const applied = applyPreset(preset.id)
      const stored = parseHomeLayoutInput(toLayoutDoc(applied))
      expect(resolveHomeLayout(stored)).toEqual(applied)
    }
  })

  it('differs from the code default — otherwise picking one would do nothing', () => {
    const fallback = resolveHomeLayout(null)
    for (const preset of HOME_PRESETS) {
      expect(applyPreset(preset.id)).not.toEqual(fallback)
    }
  })

  it('builds a fresh list every call, sharing nothing with the last', () => {
    const first = applyPreset('cut')
    const second = applyPreset('cut')
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(first[0]).not.toBe(second[0])
  })
})

describe('matchPreset', () => {
  it('recognizes every preset from the layout it produces', () => {
    for (const preset of HOME_PRESETS) {
      expect(matchPreset(applyPreset(preset.id))).toBe(preset.id)
    }
  })

  it('survives a round trip through storage', () => {
    for (const preset of HOME_PRESETS) {
      const stored = resolveHomeLayout(parseHomeLayoutInput(toLayoutDoc(applyPreset(preset.id))))
      expect(matchPreset(stored)).toBe(preset.id)
    }
  })

  it('stops recognizing a preset once a shape changes', () => {
    const applied = applyPreset('cut')
    const target = applied.find((s) => !s.hidden && s.shape !== 'micro')
    expect(target).toBeDefined()
    const edited = applied.map((s) => (s.id === target!.id ? { ...s, shape: 'micro' as const } : s))
    expect(matchPreset(edited)).toBeNull()
  })

  it('stops recognizing a preset once a section is hidden', () => {
    const applied = applyPreset('cut')
    const first = applied.find((s) => !s.hidden)!
    const edited = applied.map((s) => (s.id === first.id ? { ...s, hidden: true } : s))
    expect(matchPreset(edited)).toBeNull()
  })

  it('stops recognizing a preset once the order changes', () => {
    const applied = applyPreset('powerlifting')
    const visible = applied.filter((s) => !s.hidden)
    expect(visible.length).toBeGreaterThan(1)
    const swapped = [visible[1], visible[0], ...visible.slice(2), ...applied.filter((s) => s.hidden)]
    expect(matchPreset(swapped)).toBeNull()
  })

  it('calls the plain default what it is — not a preset', () => {
    expect(matchPreset(resolveHomeLayout(null))).toBeNull()
  })

  it('never mistakes one preset for another', () => {
    for (const preset of HOME_PRESETS) {
      const matched = matchPreset(applyPreset(preset.id))
      expect(matched).not.toBeNull()
      expect(matched).toBe(preset.id)
    }
  })
})

describe('findPreset', () => {
  it('finds every shipped preset by id', () => {
    for (const preset of HOME_PRESETS) {
      expect(findPreset(preset.id)?.id).toBe(preset.id)
    }
  })

  it('returns undefined for an unknown label rather than throwing', () => {
    // Stored labels are untrusted: a document written by a newer client may
    // name a preset this build has never heard of. The prototype keys matter
    // because the lookup is a Map — a plain object would answer 'toString'.
    for (const unknown of ['', 'CUT', 'from-the-future', '__proto__', 'toString']) {
      expect(findPreset(unknown)).toBeUndefined()
    }
  })
})
