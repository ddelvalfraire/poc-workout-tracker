import { buildSync } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('bundles and runs public configuration without Node globals or environment access', () => {
  const result = buildSync({
    entryPoints: [fileURLToPath(new URL('./constants.ts', import.meta.url))],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'publicConfig',
    treeShaking: false,
    write: false,
  })
  // A browser has no process global. Evaluate the whole module, even exports
  // a particular component would tree-shake, so eager server reads fail here.
  const config = runInNewContext(`${result.outputFiles[0].text}\npublicConfig`, {})
  expect(config.DEFAULT_WGER_API_BASE_URL).toBe('https://wger.de/api/v2')
  expect(config.DEFAULT_LANGFUSE_BASE_URL).toBe('https://cloud.langfuse.com')
  expect(config.PROPOSAL_MARKER_TTL_SECONDS).toBe(7_776_000)
})
