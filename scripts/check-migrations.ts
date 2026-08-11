/**
 * Pre-deploy migration guard (the 0041 lesson): verify the DB has applied
 * every migration in this checkout's journal BEFORE code that expects the
 * new schema ships. Run via `npm run db:check`; `npm run deploy` chains it
 * ahead of `vercel deploy --prod` so a pending migration blocks the deploy.
 *
 * Exits 0 when in sync; exits 1 with the pending/mismatched list otherwise.
 * Comparison logic (and its tests) live in src/lib/migration-guard.ts.
 */
import { readFileSync } from 'node:fs'
import { config } from 'dotenv'
import postgres from 'postgres'
import { diffMigrations, type JournalEntry } from '../src/lib/migration-guard'
import { requireEnv } from '../src/lib/env'

config({ path: '.env.local' })

async function main(): Promise<void> {
  const journalFile = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
    entries: { tag: string; when: number }[]
  }
  const journal: JournalEntry[] = journalFile.entries.map((e) => ({ tag: e.tag, when: e.when }))

  // 5432 direct/session pooler, same as drizzle.config.ts — the guard reads
  // the SAME database the migrate step writes. created_at stores the journal
  // entry's `when` (drizzle's own apply-order key) as a bigint.
  const sql = postgres(requireEnv('DATABASE_URL_DIRECT'), { max: 1 })
  try {
    const rows = await sql<{ created_at: string }[]>`
      select created_at from drizzle.__drizzle_migrations order by id
    `
    const diff = diffMigrations(
      journal,
      rows.map((r) => Number(r.created_at)),
    )

    if (diff.ok) {
      console.log(`migration guard: in sync (${journal.length} journal migrations applied)`)
      return
    }

    for (const tag of diff.pending) {
      console.error(`migration guard: PENDING ${tag} — run \`npm run db:migrate\` first`)
    }
    if (diff.dbAhead) {
      console.error(
        'migration guard: DB is AHEAD of this checkout — pull/merge the migrations before deploying',
      )
    }
    process.exitCode = 1
  } finally {
    await sql.end()
  }
}

main().catch((error: unknown) => {
  // A guard that cannot verify must not wave the deploy through.
  console.error('migration guard: check failed —', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
