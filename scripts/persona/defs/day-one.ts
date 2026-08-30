import { consentAll, setUnit } from '../actions'
import type { PersonaDefinition } from './types'

/** A brand-new account, one gesture past signup: consented, kg, nothing else. */
export const dayOne: PersonaDefinition = {
  slug: 'day-one',
  async run({ userId }) {
    await consentAll(userId)
    await setUnit(userId, 'kg')
    return {}
  },
}
