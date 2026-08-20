import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { CLIENT_NAMESPACES } from './client-namespaces'

/**
 * The provider only ships the namespaces listed in CLIENT_NAMESPACES, so a
 * Client Component reaching for one that is missing renders MISSING_MESSAGE
 * in production — and passes every test, because the test helpers hand
 * components the whole catalog on purpose.
 *
 * So the list is checked against the source tree rather than trusted: walk
 * the 'use client' files and everything they import (which the bundler also
 * sends to the browser), and collect the namespaces they bind.
 */
function clientNamespacesFromSource(): Set<string> {
  const files = execSync(
    "grep -rl . src --include='*.ts' --include='*.tsx' | grep -v '.test.' | grep -v '.stories.'",
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean)

  const text = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]))
  const isClient = (t: string) => /^\s*['"]use client['"]/.test(t)
  const client = new Set(files.filter((f) => isClient(text.get(f) ?? '')))

  const resolveImport = (spec: string, from: string): string | null => {
    let base: string
    if (spec.startsWith('@/')) base = join('src', spec.slice(2))
    else if (spec.startsWith('.')) base = relative(process.cwd(), resolve(dirname(from), spec))
    else return null
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      if (text.has(base + ext)) return base + ext
    }
    return text.has(base) ? base : null
  }

  // Anything a client file imports is bundled for the browser too.
  for (let changed = true; changed; ) {
    changed = false
    for (const f of [...client]) {
      for (const [, spec] of (text.get(f) ?? '').matchAll(/from '([^']+)'/g)) {
        const target = resolveImport(spec, f)
        if (target && !client.has(target)) {
          client.add(target)
          changed = true
        }
      }
    }
  }

  const namespaces = new Set<string>()
  for (const f of client) {
    const pattern = /(?:useTranslations|getTranslations|getMessages|catalogTranslator)\(\s*'([^']+)'/g
    for (const [, ns] of (text.get(f) ?? '').matchAll(pattern)) namespaces.add(ns)
  }
  return namespaces
}

describe('client namespace list', () => {
  it('covers every namespace a Client Component binds', () => {
    const listed = new Set<string>(CLIENT_NAMESPACES)
    const catalog = JSON.parse(readFileSync(join(process.cwd(), 'messages', 'en.json'), 'utf8'))
    const required = [...clientNamespacesFromSource()].filter((ns) => ns in catalog)

    const missing = required.filter((ns) => !listed.has(ns))
    expect(missing, 'these render MISSING_MESSAGE in the browser').toEqual([])
  })

  it('ships nothing the browser does not need', () => {
    // Not a correctness failure, but every stale entry is payload on every
    // route — the regression this list exists to prevent.
    const required = clientNamespacesFromSource()
    const stale = CLIENT_NAMESPACES.filter((ns) => !required.has(ns))
    expect(stale).toEqual([])
  })
})
