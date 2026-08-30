/**
 * Fail-closed host check: refuses to let Persona Foundry run against anything
 * but a local database unless the caller opts in explicitly. Deliberately has
 * no `@/*` imports — it must stay safe to import at the very top of
 * `scripts/seed-persona.ts`, before `@/db/*` (which connects at import time)
 * is ever reached.
 */

const LOCAL_HOST_PATTERN = /@(localhost|127\.0\.0\.1|host\.docker\.internal|db):/

/** Strips credentials/path from a connection string, leaving just the host,
 *  for safe inclusion in an error message. */
function hostOnly(databaseUrl: string): string {
  return databaseUrl.replace(/^.*@/, '').replace(/[/?].*$/, '')
}

/**
 * Throws unless `databaseUrl` matches a local-only host, or
 * `process.env[allowRemoteEnvVar] === '1'`. An empty/undefined url fails
 * closed — a missing DATABASE_URL must never silently "pass".
 */
export function assertLocalDatabase(databaseUrl: string, allowRemoteEnvVar: string): void {
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is empty — Persona Foundry refuses to run without a known database target.',
    )
  }
  if (LOCAL_HOST_PATTERN.test(databaseUrl)) return
  if (process.env[allowRemoteEnvVar] === '1') return

  throw new Error(
    `Refusing to run Persona Foundry against a non-local database (${hostOnly(databaseUrl)}).\n` +
      'This script creates users and writes real domain data. Point DATABASE_URL at a\n' +
      `local or disposable database, or set ${allowRemoteEnvVar}=1 if you mean it.`,
  )
}
