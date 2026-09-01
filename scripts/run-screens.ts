/**
 * `npm run screens` entrypoint — guards against a remote database, seeds any
 * missing persona (so a fresh checkout can run this with zero prior setup
 * beyond the emulator + consent/template seeds), then spawns the dedicated
 * screens Playwright config.
 *
 * MANUAL INVOCATION ONLY, LOCAL DATABASE ONLY. See scripts/persona/guard.ts.
 *
 *   npm run screens -- --persona day-one
 *   npm run screens -- --persona all
 *   npm run screens -- --user someone@example.com
 */
import { config } from 'dotenv'

config({ path: '.env.local' })
config()

import { assertLocalDatabase } from './persona/guard'
assertLocalDatabase(process.env.DATABASE_URL ?? '', 'PERSONA_ALLOW_REMOTE_DB')

import { execFileSync } from 'node:child_process'
import { readManifest } from './persona/manifest'

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main(): Promise<void> {
  const personaArg = arg('--persona')
  const userArg = arg('--user')
  if (!personaArg && !userArg) {
    throw new Error('usage: screens --persona <slug|all> | --user <email>')
  }

  const env = { ...process.env }
  if (userArg) {
    env.SCREENS_TARGET_USER = userArg
  } else {
    const { PERSONA_REGISTRY } = await import('./persona/registry')
    const slugs = personaArg === 'all' ? Object.keys(PERSONA_REGISTRY) : [personaArg!]
    for (const slug of slugs) {
      if (!PERSONA_REGISTRY[slug]) throw new Error(`unknown persona "${slug}"`)
      if (await readManifest(slug)) continue
      console.log(`[screens] seeding missing persona "${slug}"...`)
      execFileSync('npx', ['tsx', 'scripts/seed-persona.ts', '--persona', slug], { stdio: 'inherit' })
    }
  }

  const projectArgs = userArg
    ? ['--project=setup:user', '--project=capture:user']
    : personaArg === 'all'
      ? []
      : [`--project=setup:${personaArg}`, `--project=capture:${personaArg}`]

  execFileSync(
    'npx',
    ['playwright', 'test', '--config=playwright.screens.config.ts', ...projectArgs],
    { stdio: 'inherit', env },
  )
  console.log('[screens] done — run `npx playwright show-report` to view the gallery.')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
