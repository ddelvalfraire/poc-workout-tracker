import { REST_OVER_VIBRATION } from '@/lib/rest-alert'
import { vibrate } from './haptics'
import { playRestChime } from './rest-chime'

/**
 * The rest-over moment's side effects — vibration, the optional chirp, and a
 * document.title flash for a backgrounded tab. Fired once per rest period by
 * RestPill's edge detector (lib/rest-alert owns the once-only contract;
 * this module is deliberately dumb about timing).
 *
 * NO push notifications and NO permission prompts, ever — the notifications
 * decision stands: push is deferred, and any permission ask must be
 * gesture-driven from /settings, not ambushed from a timer.
 */

const FLASH_TITLE = 'REST OVER'

export function fireRestOverAlert(): void {
  vibrate(REST_OVER_VIBRATION)
  playRestChime()
  flashTitle()
}

/**
 * Title flash for a hidden tab only (a visible app already shows the volt
 * "+overage" readout — flashing the title there would never restore, since
 * restore rides the hidden→visible edge). Restored on visibilitychange or
 * focus, whichever lands first; listeners self-remove.
 */
function flashTitle(): void {
  if (typeof document === 'undefined') return
  if (document.visibilityState === 'visible') return
  if (document.title === FLASH_TITLE) return // already flashing (double fire safety)
  const original = document.title
  const onVisibility = () => {
    if (document.visibilityState === 'visible') restore()
  }
  const restore = () => {
    document.title = original
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('focus', restore)
  }
  document.title = FLASH_TITLE
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', restore)
}
