import type { Rng } from '../rng'
import type { PersonaClock } from '../clock'
import type { PersonaManifest } from '../manifest'

/** Everything a persona definition's `run` needs to materialize its state. */
export interface PersonaRunContext {
  userId: string
  email: string
  seed: number
  rng: Rng
  clock: PersonaClock
}

/** One named persona: a slug, and the writes that produce it. */
export interface PersonaDefinition {
  slug: string
  /** Returns the manifest fields this persona populates beyond the base five
   *  (persona, userId, email, seed, anchor — filled in by the CLI). */
  run(ctx: PersonaRunContext): Promise<Partial<PersonaManifest>>
}
