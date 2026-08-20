import { describe, it, expect } from 'vitest'
import { Project, QuoteKind, IndentationText } from 'ts-morph'
import { namespaceFor, keyForRole, normalizeText, uniqueKey, extractFromFile } from './i18n-extract'

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

  it('skips dynamic segments instead of naming a route after its param', () => {
    // Regression: [id] and [token] are not names. These four routes all
    // resolved to 'Id' and both share routes to 'Token', so two pages' copy
    // merged into one namespace and one silently rendered the other's text.
    expect(namespaceFor('src/app/programs/[id]/page.tsx')).toBe('Programs')
    expect(namespaceFor('src/app/workout/[id]/page.tsx')).toBe('Workout')
    expect(namespaceFor('src/app/templates/[id]/page.tsx')).toBe('Templates')
    expect(namespaceFor('src/app/exercises/[source]/[id]/page.tsx')).toBe('Exercises')
    expect(namespaceFor('src/app/(legal)/terms/page.tsx')).toBe('Terms')
  })

  it('gives distinct namespaces to routes that used to collide', () => {
    const namespaces = [
      'src/app/programs/[id]/page.tsx',
      'src/app/workout/[id]/page.tsx',
      'src/app/templates/[id]/page.tsx',
      'src/app/exercises/[source]/[id]/page.tsx',
    ].map(namespaceFor)

    expect(new Set(namespaces).size).toBe(namespaces.length)
  })

  it('names a component by its own filename', () => {
    expect(namespaceFor('src/components/nav/nav-drawer.tsx')).toBe('NavDrawer')
    expect(namespaceFor('src/app/workout/new/workout-logger.tsx')).toBe('WorkoutLogger')
  })
})

describe('keyForRole', () => {
  it('names the role the markup gives the string, not its text', () => {
    expect(keyForRole('h1')).toBe('title')
    expect(keyForRole('p')).toBe('description')
    expect(keyForRole('button')).toBe('action')
    expect(keyForRole('summary')).toBe('summary')
  })

  it('reads a component wrapper as the role', () => {
    expect(keyForRole('EmptyWords')).toBe('empty')
  })

  it('falls back to a generic leaf rather than inventing meaning', () => {
    expect(keyForRole('span')).toBe('label')
    expect(keyForRole(undefined)).toBe('text')
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

    expect(result.extracted).toEqual({ title: 'Trophies' })
    expect(file.getFullText()).toContain("const t = await getTranslations('Trophies')")
    expect(file.getFullText()).toContain("from 'next-intl/server'")
    expect(file.getFullText()).toContain("{t('title')}")
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

  it('never puts a hook inside a .map callback, even with a block body', () => {
    // Regression: "nearest function with a block body" matched the callback,
    // so the hook ran once per item — React throws the moment the list
    // length changes between renders.
    const file = sourceFile(`
export function List({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((item) => {
        return <li key={item}>Fixed label</li>
      })}
    </ul>
  )
}
`)
    extractFromFile(file, 'List')
    const text = file.getFullText()

    expect(text).toContain("{t('item')}")
    // The declaration belongs to the component, above the return.
    expect(text.indexOf('const t = useTranslations')).toBeLessThan(text.indexOf('items.map'))
    expect(text.match(/const t = useTranslations/g)).toHaveLength(1)
  })

  it('puts the translator on the component, not on a handler declared above it', () => {
    // Regression: hasTranslatorDeclared regexed statement TEXT, and a
    // statement's text includes nested function bodies — so once the handler
    // had a translator the component looked declared, and its own `t` was
    // never inserted, leaving an out-of-scope reference.
    const file = sourceFile(`
export function Page() {
  const onClick = () => {
    show(<p>Saved successfully</p>)
  }
  return <button onClick={onClick}>Go</button>
}
`)
    extractFromFile(file, 'Page')
    const text = file.getFullText()

    expect(text.match(/const t = useTranslations/g)).toHaveLength(1)
    // It sits in Page's body, before the handler that also needs it.
    expect(text.indexOf('const t = useTranslations')).toBeLessThan(text.indexOf('const onClick'))
    expect(text).toContain("{t('action')}")
    expect(text).toContain("{t('description')}")
  })

  it('refuses a component already bound to a different namespace', () => {
    // Regression: the key was written under the file's namespace while `t`
    // resolved against the bound one — compiles, type-checks, then misses at
    // runtime with MISSING_MESSAGE.
    const file = sourceFile(`
export function Widget() {
  const t = useTranslations('Other')
  return (
    <div>
      <p>New static text</p>
    </div>
  )
}
`)
    const result = extractFromFile(file, 'Widget')

    expect(result.extracted).toEqual({})
    expect(result.skips).toHaveLength(1)
    expect(result.skips[0].reason).toContain("already bound to namespace 'Other'")
    expect(file.getFullText()).toContain('New static text')
  })

  it('still extracts when the existing translator is for the same namespace', () => {
    const file = sourceFile(`
export function Widget() {
  const t = useTranslations('Widget')
  return <p>New static text</p>
}
`)
    const result = extractFromFile(file, 'Widget')

    expect(result.extracted).toEqual({ description: 'New static text' })
    expect(file.getFullText().match(/const t = useTranslations/g)).toHaveLength(1)
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
