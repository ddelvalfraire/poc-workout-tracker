/**
 * Seeds/updates the template library — the system account's public program
 * rows that /programs/templates lists and adoptTemplate copies from.
 *
 * MANUAL INVOCATION ONLY. This script is deliberately NOT wired into CI, the
 * build, or any app code path — content changes to the library are deploys
 * of data, run by a human against the environment they mean to touch:
 *
 *   npm run db:seed-templates        # reads DATABASE_URL from .env.local
 *   DATABASE_URL=postgres://… npx tsx scripts/seed-templates.ts
 *
 * Idempotent by NAME: a template whose name already exists under the system
 * owner is full-replaced via updateProgram (same id, overrides preserved);
 * a new name is created via saveProgram. Never raw SQL — every write rides
 * the same validated creation paths the app uses, so structure, muscle tags,
 * and change-log events hold. Before writing anything, every wgerExerciseId
 * in the canon is checked against the live exercise catalog (the same
 * `getAllExercises` path the app resolves against); an unknown id aborts the
 * whole run.
 */
import { config } from 'dotenv'

config({ path: '.env.local' }) // plain node does not read .env.local
config() // …then .env, for environments that use it

async function main(): Promise<void> {
  // Imports live inside main, AFTER dotenv ran: src/db/index.ts requires
  // DATABASE_URL at module init.
  const [{ parseProgramInput }, { TEMPLATE_CANON }, { TEMPLATE_OWNER_USER_ID }] = await Promise.all(
    [
      import('../src/lib/program-input'),
      import('../src/lib/template-canon'),
      import('../src/lib/template-owner'),
    ],
  )
  const { listPrograms, saveProgram, updateProgram } = await import('../src/db/programs')
  const { getAllExercises } = await import('../src/lib/wger')

  // Validate every payload through the boundary FIRST — nothing writes if
  // any template is malformed (all-or-nothing at the content level).
  const templates = TEMPLATE_CANON.map((raw) => parseProgramInput(raw))

  // Catalog check: every referenced wger id must resolve in the same catalog
  // path the app tags muscles from.
  const catalog = new Set((await getAllExercises()).map((e) => e.id))
  for (const template of templates) {
    for (const day of template.days) {
      for (const exercise of day.exercises) {
        if (!catalog.has(exercise.wgerExerciseId)) {
          throw new Error(
            `"${template.name}" references wger id ${exercise.wgerExerciseId} (${exercise.name}) not present in the live catalog — aborting, nothing written`,
          )
        }
      }
    }
  }

  const existing = await listPrograms(TEMPLATE_OWNER_USER_ID)
  for (const template of templates) {
    const match = existing.find((p) => p.name === template.name)
    if (match) {
      const updated = await updateProgram(TEMPLATE_OWNER_USER_ID, match.id, template, 'seed')
      if (!updated) throw new Error(`update refused for "${template.name}" (${match.id})`)
      console.log(`updated  ${template.name} (${match.id})`)
    } else {
      const created = await saveProgram(TEMPLATE_OWNER_USER_ID, template, 'seed')
      console.log(`created  ${template.name} (${created.id})`)
    }
  }
  console.log(`done — ${templates.length} templates live under '${TEMPLATE_OWNER_USER_ID}'`)
}

main()
  .then(() => process.exit(0)) // the pg connection would otherwise hold the loop open
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
