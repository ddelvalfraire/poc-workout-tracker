/**
 * Persona Foundry — materializes a named user state in the local database.
 *
 * MANUAL INVOCATION ONLY, LOCAL DATABASE ONLY. See scripts/persona/guard.ts.
 *
 * PREREQUISITES (run once against this database, in order):
 *   npm run db:seed-consent-docs
 *   npm run db:seed-templates        # only needed for personas that adopt a program
 *   npx workos@latest emulate --port 4100 --interactive   # in a separate terminal
 *
 *   npm run persona -- --persona day-one
 *   npm run persona -- --persona week-one --seed 7
 *   npm run persona -- --persona day-one --purge --commit
 */
import { config } from 'dotenv'

config({ path: '.env.local' }) // plain node does not read .env.local
config() // …then .env, for environments that use it

import { assertLocalDatabase } from './persona/guard'
import { createRng } from './persona/rng'
import { createClock } from './persona/clock'
import { readManifest, writeManifest, deleteManifest } from './persona/manifest'

// Must run at module top level, before main() is even defined/called — this
// throws synchronously before anything else in the process happens, and
// before any @/db/* import (which connects at import time) is reachable.
assertLocalDatabase(process.env.DATABASE_URL ?? '', 'PERSONA_ALLOW_REMOTE_DB')

interface Args {
  personas: string[]
  seed: number
  userId?: string
  purge: boolean
  commit: boolean
}

function parseArgs(argv: string[], knownSlugs: string[]): Args {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i === -1 ? undefined : argv[i + 1]
  }
  const personaArg = value('--persona')
  if (!personaArg) {
    throw new Error(
      'usage: seed-persona --persona <slug|all> [--seed <n>] [--user-id <id>] [--purge [--commit]]',
    )
  }
  const seed = Number(value('--seed') ?? 42)
  if (Number.isNaN(seed)) throw new Error('--seed must be a number')
  return {
    personas: personaArg === 'all' ? knownSlugs : [personaArg],
    seed,
    userId: value('--user-id'),
    purge: argv.includes('--purge'),
    commit: argv.includes('--commit'),
  }
}

async function main(): Promise<void> {
  // Imports live inside main, AFTER dotenv ran and the guard above passed:
  // these transitively reach @/db/*, which connects to DATABASE_URL at
  // module init.
  const { PERSONA_REGISTRY } = await import('./persona/registry')
  const { createPersonaIdentity, deletePersonaIdentity, purgePersona } = await import(
    './persona/actions'
  )

  const args = parseArgs(process.argv.slice(2), Object.keys(PERSONA_REGISTRY))

  for (const slug of args.personas) {
    const def = PERSONA_REGISTRY[slug]
    if (!def) {
      throw new Error(`unknown persona "${slug}" — known: ${Object.keys(PERSONA_REGISTRY).join(', ')}`)
    }

    if (args.purge) {
      const existing = await readManifest(slug)
      const targetId = args.userId ?? existing?.userId
      if (!targetId) {
        console.log(`[persona] ${slug}: nothing to purge`)
        continue
      }
      if (!args.commit) {
        console.info(`[persona] DRY RUN — would purge ${slug} (${targetId}). Re-run with --commit.`)
        continue
      }
      await purgePersona(targetId)
      if (!args.userId && existing) await deletePersonaIdentity(existing.userId)
      await deleteManifest(slug)
      console.log(`[persona] ${slug}: purged`)
      continue
    }

    const existing = await readManifest(slug)
    const identity = args.userId
      ? { id: args.userId, email: existing?.email ?? '(unknown — --user-id supplied)' }
      : existing
        ? { id: existing.userId, email: existing.email }
        : await createPersonaIdentity(slug)

    const rng = createRng(args.seed)
    const anchor = new Date()
    const clock = createClock(anchor)
    const extra = await def.run({ userId: identity.id, email: identity.email, seed: args.seed, rng, clock })

    const manifest = {
      persona: slug,
      userId: identity.id,
      email: identity.email,
      seed: args.seed,
      anchor: anchor.toISOString(),
      ...extra,
    }
    await writeManifest(slug, manifest)
    console.log(
      `[persona] ${slug}: seed=${args.seed} anchor=${manifest.anchor} userId=${identity.id} email=${identity.email}`,
    )
  }
}

main()
  .then(() => process.exit(0)) // the pg connection would otherwise hold the loop open
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
