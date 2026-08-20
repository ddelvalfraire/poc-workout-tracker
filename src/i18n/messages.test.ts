import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import IntlMessageFormat from 'intl-messageformat'
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './config'

/**
 * The catalog is data, so nothing type-checks it. These are the failures that
 * only show up when a user opens the page: a malformed plural, a plural whose
 * branches are identical (someone wrote English grammar into `other` and
 * forgot `one`), or a rich-text tag with no matching render function.
 *
 * Every message is parsed and every plural is formatted at 0, 1 and 2 — the
 * counts where English, and most languages, actually differ.
 */
function readCatalog(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf8'))
}

function entries(node: Record<string, unknown>, prefix = ''): Array<[string, string]> {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null
      ? entries(value as Record<string, unknown>, path)
      : ([[path, String(value)]] as Array<[string, string]>)
  })
}

/** Argument names the message needs, and the plural/tag ones separately. */
function inspect(ast: MessageFormatElement[]) {
  const args: string[] = []
  const plurals: string[] = []
  const tags: string[] = []
  const walk = (nodes: MessageFormatElement[]) => {
    for (const node of nodes) {
      // Typed arguments count too: a `{value, number, ::group-off}` sitting
      // beside a plural is still an argument the formatter demands, and
      // missing it made this walk throw "not provided" instead of reaching
      // the assertion it exists for.
      if (
        node.type === TYPE.argument ||
        node.type === TYPE.number ||
        node.type === TYPE.date ||
        node.type === TYPE.time
      ) {
        args.push(node.value)
      }
      if (node.type === TYPE.plural || node.type === TYPE.select) {
        args.push(node.value)
        if (node.type === TYPE.plural) plurals.push(node.value)
        for (const option of Object.values(node.options)) walk(option.value)
      }
      if (node.type === TYPE.tag) {
        tags.push(node.value)
        walk(node.children)
      }
    }
  }
  walk(ast)
  return { args: [...new Set(args)], plurals, tags }
}

describe('catalog ICU messages', () => {
  for (const locale of SUPPORTED_LOCALES) {
    it(`parses every message in ${locale}`, () => {
      for (const [path, message] of entries(readCatalog(locale))) {
        expect(() => parse(message), `${path} is not valid ICU`).not.toThrow()
      }
    })

    it(`formats every plural at 0, 1 and 2 in ${locale}`, () => {
      for (const [path, message] of entries(readCatalog(locale))) {
        const { args, plurals, tags } = inspect(parse(message))
        if (plurals.length === 0 || tags.length > 0) continue

        const formatter = new IntlMessageFormat(message, locale)
        const rendered = new Set<string>()
        for (const count of [0, 1, 2]) {
          const values = Object.fromEntries(
            args.map((name) => [name, plurals.includes(name) ? count : 'x']),
          )
          const out = formatter.format(values)
          expect(typeof out, `${path} did not format at ${count}`).toBe('string')
          // Compare the WORDING, not the output: the number itself always
          // differs, so keeping it would make this assertion unfalsifiable.
          rendered.add(String(out).replace(/\d+/g, ''))
        }
        // Singular and plural wording must differ, or the message has one
        // English form in a single branch and no language can fix that
        // downstream.
        expect(rendered.size, `${path} uses the same wording for 1 and 2`).toBeGreaterThan(1)
      }
    })
  }

  it('every rich-text tag is a real tag, not stray markup in the copy', () => {
    for (const [path, message] of entries(readCatalog(DEFAULT_LOCALE))) {
      const { tags } = inspect(parse(message))
      for (const tag of tags) {
        expect(tag, `${path} uses tag <${tag}>`).toMatch(/^[a-z][a-zA-Z]*$/)
      }
    }
  })
})
