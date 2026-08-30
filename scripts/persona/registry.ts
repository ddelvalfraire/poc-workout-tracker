import { dayOne } from './defs/day-one'
import { weekOne } from './defs/week-one'
import type { PersonaDefinition } from './defs/types'

/** slug -> PersonaDefinition. The ONLY file later phases touch to add a
 *  persona. */
export const PERSONA_REGISTRY: Record<string, PersonaDefinition> = {
  'day-one': dayOne,
  'week-one': weekOne,
}
