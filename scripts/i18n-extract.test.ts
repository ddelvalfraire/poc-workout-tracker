import { describe, it, expect } from 'vitest'
import { Project, QuoteKind, IndentationText } from 'ts-morph'
import { namespaceFor, keyFor, normalizeText, uniqueKey, extractFromFile } from './i18n-extract'

/**
 * The codemod runs across ~100 files, so its mistakes are systematic rather
 * than one-off. The cases that matter are the ones where a wrong rewrite is
 * SILENT: a hook placed in an async Server Component (throws only when that
 * route is hit), or an interpolated sentence half-extracted (renders as a
 * stranded fragment). Both are pinned below.
 */
function sourceFile(code: string, path = 'src/app/demo/page.tsx') {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 4 },
    manipulationSettings: {
      quoteKind: QuoteKind.Single,
      indentationText: IndentationText.TwoSpaces,
    },
  })
  return project.createSourceFile(path, code)
}

describe('namespaceFor', () => {
  it('names a route by its directory when the file is structural', () => {
    expect(namespaceFor('src/app/trophies/page.tsx')).toBe('Trophies')
    expect(namespaceFor('src/app/settings/layout.tsx')).toBe('Settings')
  })

  it('names a component by its own filename', () => {
    expect(namespaceFor('src/components/nav/nav-drawer.tsx')).toBe('NavDrawer')
    expect(namespaceFor('src/app/workout/new/workout-logger.tsx')).toBe('WorkoutLogger')
  })
})

describe('keyFor', () => {
  it('builds a camelCase key from the copy itself', () => {
    expect(keyFor('Closest')).toBe('closest')
    expect(keyFor('No trophies yet')).toBe('noTrophiesYet')
  })

  it('drops punctuation and caps length so a sentence still yields a key', () => {
    expect(keyFor('No trophies yet. Every trophy is a lifting fact — plate clubs.')).toBe(
      'noTrophiesYetEveryTrophy',
    )
  })

  it('falls back rather than producing an empty key', () => {
    expect(keyFor('—')).toBe('text')
  })
})

describe('normalizeText', () => {
  it('collapses the whitespace JSX preserves across wrapped lines', () => {
    expect(normalizeText('\n   Train and they\n   stamp themselves.\n  ')).toBe(
      'Train and they stamp themselves.',
    )
  })
})

describe('uniqueKey', () => {
  it('suffixes rather than overwriting when two messages share a key', () => {
    expect(uniqueKey('save', new Set(['save']))).toBe('save2')
    expect(uniqueKey('save', new Set(['save', 'save2']))).toBe('save3')
  })
})

describe('extractFromFile', () => {
  it('uses awaited getTranslations in an async Server Component', () => {
    const file = sourceFile(`
export default async function Page() {
  return <h1>Trophies</h1>
}
`)
    const result = extractFromFile(file, 'Trophies')

    expect(result.extracted).toEqual({ trophies: 'Trophies' })
    expect(file.getFullText()).toContain("const t = await getTranslations('Trophies')")
    expect(file.getFullText()).toContain("from 'next-intl/server'")
    expect(file.getFullText()).toContain("{t('trophies')}")
  })

  it('uses the hook in a sync component', () => {
    const file = sourceFile(`
export function Badge() {
  return <span>New</span>
}
`)
    extractFromFile(file, 'Trophies')

    expect(file.getFullText()).toContain("const t = useTranslations('Trophies')")
    expect(file.getFullText()).toContain("from 'next-intl'")
  })

  it('is not fooled by a JSDoc comment above an async component', () => {
    // Regression: classifying by node text saw the leading "/**" instead of
    // `async`, so a documented page got a hook — which throws at runtime.
    const file = sourceFile(`
/** The trophy case. */
export default async function Page() {
  return <h1>Trophies</h1>
}
`)
    extractFromFile(file, 'Trophies')

    expect(file.getFullText()).toContain('await getTranslations')
    expect(file.getFullText()).not.toContain('useTranslations')
  })

  it('refuses text that sits beside an expression, leaving it untouched', () => {
    const file = sourceFile(`
export function Count({ n }: { n: number }) {
  return <p>{n} sets left</p>
}
`)
    const result = extractFromFile(file, 'Logger')

    expect(result.extracted).toEqual({})
    expect(result.skips).toHaveLength(1)
    expect(result.skips[0].reason).toContain('interpolated')
    expect(file.getFullText()).toContain('{n} sets left')
  })

  it('leaves whitespace-only JSX text alone', () => {
    const file = sourceFile(`
export function Row() {
  return (
    <div>
      <span>{'x'}</span>
    </div>
  )
}
`)
    const result = extractFromFile(file, 'Row')

    expect(result.extracted).toEqual({})
    expect(result.skips).toEqual([])
  })

  it('declares the translator once per component, not once per message', () => {
    const file = sourceFile(`
export function Panel() {
  return (
    <div>
      <h2>Closest</h2>
      <p>Keep going</p>
    </div>
  )
}
`)
    const result = extractFromFile(file, 'Panel')
    const declarations = file.getFullText().match(/const t = useTranslations/g) ?? []

    expect(Object.keys(result.extracted)).toHaveLength(2)
    expect(declarations).toHaveLength(1)
  })

  it('matches the file style when it uses semicolons and when it does not', () => {
    const noSemi = sourceFile(`
import { useState } from 'react'

export function A() {
  return <p>Hello</p>
}
`)
    extractFromFile(noSemi, 'A')
    expect(noSemi.getFullText()).not.toContain("from 'next-intl';")

    const semi = sourceFile(
      `
import { useState } from "react";

export function B() {
  return <p>Hello</p>;
}
`,
      'src/app/other/page.tsx',
    )
    extractFromFile(semi, 'B')
    expect(semi.getFullText()).toContain("from 'next-intl';")
  })
})
