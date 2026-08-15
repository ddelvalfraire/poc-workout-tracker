import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * The spike-§3c fallback table, enforced at the source level: every back
 * affordance must be a <BackLink> with its page's CANONICAL parent as the
 * fallback, and no page may keep a hardcoded back-chevron <Link>. A source
 * assertion (not a render) because these are async server components whose
 * data layers can't run in a unit test — the table is the contract.
 */
const ROOT = join(__dirname, '..', '..')

const FALLBACK_TABLE: { file: string; fallback: string; count?: number }[] = [
  { file: 'src/app/settings/page.tsx', fallback: '"/"' },
  { file: 'src/app/settings/import/page.tsx', fallback: '"/settings"' },
  { file: 'src/app/programs/[id]/page.tsx', fallback: '"/programs"' },
  {
    file: 'src/app/programs/[id]/stats/page.tsx',
    fallback: '{`/programs/${stats.program.id}`}',
  },
  { file: 'src/app/programs/templates/page.tsx', fallback: '"/programs"' },
  // Two renders (unavailable + detail), both with the same parent.
  { file: 'src/app/programs/templates/[id]/page.tsx', fallback: '"/programs/templates"', count: 2 },
  { file: 'src/app/exercises/[source]/[id]/page.tsx', fallback: '{backHref}' },
  { file: 'src/app/history/page.tsx', fallback: '"/"' },
  { file: 'src/app/templates/[id]/page.tsx', fallback: '"/templates"' },
  // Q1 decision: a workout record's canonical parent is the training log.
  { file: 'src/app/workout/[id]/page.tsx', fallback: '"/history"' },
  { file: 'src/components/ops/ops-header.tsx', fallback: '"/"' },
]

describe('spike §3c fallback table', () => {
  test.each(FALLBACK_TABLE)('$file falls back to $fallback', ({ file, fallback, count }) => {
    const source = readFileSync(join(ROOT, file), 'utf8')
    const needle = `<BackLink fallback=${fallback}`
    const occurrences = source.split(needle).length - 1
    expect(occurrences).toBe(count ?? 1)
    // The affordance is BackLink-only now: no leftover hardcoded chevron Link.
    expect(source).not.toMatch(/aria-label="Back"[\s\S]{0,120}ChevronLeft/)
  })

  test('the logger exits through the shared back mechanics, never a push', () => {
    const source = readFileSync(join(ROOT, 'src/app/workout/new/workout-logger.tsx'), 'utf8')
    expect(source).toContain('navigateBack(router, closeHref)')
    // Finish and discard are redirect-ish hops: replace + markReplace only.
    // The ONE sanctioned push is #218's create-exercise hop — a forward step
    // whose back must return INTO the logger, so push is the correct verb.
    const pushCalls = source.match(/router\.push\(/g) ?? []
    expect(pushCalls.length).toBe(1)
    expect(source).toContain('router.push(`/exercises/new?')
    const replaceCalls = source.match(/router\.replace\(/g) ?? []
    expect(replaceCalls.length).toBe(3) // two finish branches + discard exit
    const markCalls = source.match(/markReplace\(\)/g) ?? []
    expect(markCalls.length).toBe(3) // every replace is announced to the tracker
  })
})
