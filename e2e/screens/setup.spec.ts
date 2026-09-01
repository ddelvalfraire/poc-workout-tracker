import { test } from './fixtures'
import { signIn } from '../auth'
import { resolveManifest } from './resolve-manifest'

/** Signs in once per persona (or --user target) through the real emulator
 *  flow and saves storageState — the capture:<slug> project depends on this
 *  project so every capture test starts already authenticated. */
test('sign in and save storage state', async ({ page, personaSlug }) => {
  const resolved = await resolveManifest(personaSlug)
  await signIn(page, { email: resolved.email })
  await page.context().storageState({ path: `playwright/.auth/${personaSlug}.json` })
})
