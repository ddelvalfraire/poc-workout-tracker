/**
 * ONE-TIME account-id migration: rewrites every `user_id` from a Clerk id to
 * the WorkOS id the same person now signs in with.
 *
 * We deliberately do NOT keep the Clerk ids and map them through WorkOS's
 * `external_id`: that leaves two id vocabularies alive forever, in the
 * database, the consent ledger and PostHog. With a single real user to move,
 * rewriting the ids is the smaller lasting cost — after this the app knows
 * exactly one kind of user id.
 *
 * MANUAL INVOCATION ONLY, and only after the WorkOS account exists (sign in
 * once through AuthKit so the WorkOS user is created, then read its id from
 * the dashboard):
 *
 *   npm run db:migrate-user -- --from user_2abc... --to user_01JXYZ...
 *   npm run db:migrate-user -- --from ... --to ... --commit
 *
 * Dry run by default: it prints the per-table row counts it WOULD move and
 * changes nothing. `--commit` performs the rewrite in ONE transaction across
 * every user-scoped table — a partial migration would split an account in
 * half, which is worse than not starting.
 *
 * Idempotent: re-running after a successful commit finds nothing under the
 * old id and reports the account as already migrated.
 *
 * The consent ledger moves with everything else — it is append-only at the
 * database, and the one mutation its trigger sanctions (user_id alone, no
 * other column) is exactly the one this performs. Leaving it behind would
 * strand the retention evidence on an id nobody signs in with.
 */
import { config } from 'dotenv'

config({ path: '.env.local' }) // plain node does not read .env.local
config() // …then .env, for environments that use it

interface Args {
  from: string
  to: string
  commit: boolean
}

function parseArgs(argv: string[]): Args {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index === -1 ? undefined : argv[index + 1]
  }

  const from = value('--from')
  const to = value('--to')
  if (from === undefined || to === undefined) {
    throw new Error('usage: migrate-user-id --from <old-user-id> --to <new-user-id> [--commit]')
  }
  if (from === to) throw new Error('--from and --to are the same id; nothing to migrate')

  return { from, to, commit: argv.includes('--commit') }
}

async function main() {
  const { from, to, commit } = parseArgs(process.argv.slice(2))

  // Imports live inside main, AFTER dotenv ran: src/db/index.ts requires
  // DATABASE_URL at module init (same idiom as the seed scripts).
  const { db } = await import('../src/db/index')
  const { userScopedTableNames } = await import('../src/db/user-scoped-tables')
  const { sql } = await import('drizzle-orm')

  const tables = userScopedTableNames()
  console.info(`[migrate-user-id] ${tables.length} user-scoped tables`)
  console.info(`[migrate-user-id] ${from} -> ${to}`)

  // Preflight BEFORE the transaction: an id that already owns rows means
  // either a half-finished run or the wrong --to, and both want a human.
  let fromRows = 0
  let toRows = 0
  for (const table of tables) {
    const rows = await db.execute<{ from_count: string; to_count: string }>(sql`
      select
        count(*) filter (where user_id = ${from}) as from_count,
        count(*) filter (where user_id = ${to}) as to_count
      from ${sql.identifier(table)}
    `)
    const tableFrom = Number(rows[0]?.from_count ?? 0)
    const tableTo = Number(rows[0]?.to_count ?? 0)
    fromRows += tableFrom
    toRows += tableTo
    if (tableFrom > 0 || tableTo > 0) {
      console.info(`  ${table}: ${tableFrom} to move, ${tableTo} already on the new id`)
    }
  }

  if (fromRows === 0 && toRows > 0) {
    console.info(`[migrate-user-id] already migrated — ${toRows} rows on ${to}, none on ${from}`)
    return
  }
  if (fromRows === 0) {
    throw new Error(`no rows found for ${from}; check the id before re-running`)
  }
  if (toRows > 0) {
    throw new Error(
      `${to} already owns ${toRows} rows while ${fromRows} remain on ${from} — ` +
        'a previous run stopped midway, or --to is wrong. Resolve this by hand.',
    )
  }

  if (!commit) {
    console.info(`[migrate-user-id] DRY RUN — would move ${fromRows} rows. Re-run with --commit.`)
    return
  }

  // One transaction: the account moves whole or not at all.
  const moved = await db.transaction(async (tx) => {
    // consent_events is append-only at the database (migration 0047). The
    // 0049 gate opens for exactly one shape of mutation: an UPDATE that
    // changes user_id and NOTHING else — which is precisely this migration.
    // SET LOCAL scopes the permission to this transaction; it takes no bind
    // parameters, and the value is a constant.
    await tx.execute(sql`SET LOCAL app.consent_pseudonymize = 'on'`)

    let total = 0
    for (const table of tables) {
      const result = await tx.execute(sql`
        update ${sql.identifier(table)} set user_id = ${to} where user_id = ${from}
      `)
      const count = typeof result.count === 'number' ? result.count : 0
      if (count > 0) console.info(`  ${table}: ${count} rows`)
      total += count
    }
    return total
  })

  console.info(`[migrate-user-id] moved ${moved} rows to ${to}`)
  console.info('[migrate-user-id] delete the Clerk user by hand once you have verified the app.')
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('[migrate-user-id] failed', error)
    process.exit(1)
  })
