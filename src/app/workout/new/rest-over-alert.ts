import { REST_OVER_VIBRATION } from '@/lib/rest-alert'
import { vibrate } from './haptics'
import { playRestChime } from './rest-chime'

/**
 * The rest-over moment's side effects — vibration, the optional chirp, a
 * document.title flash for a backgrounded tab, and (only when notification
 * permission ALREADY exists) a local notification posted through the service
 * worker. Fired once per rest period by RestPill's edge detector
 * (lib/rest-alert owns the once-only contract; this module is deliberately
 * dumb about timing).
 *
 * NO permission prompts, ever — any permission ask stays gesture-driven from
 * /settings, never ambushed from a timer. The notifications decision has
 * NARROWED, not reversed: a user who already granted permission (via the
 * /settings opt-in) also gets a LOCAL notification here, because on an iOS
 * home-screen install with the phone locked it is the only rest-over output
 * that exists (no navigator.vibrate, no tab title to flash, and a suspended
 * AudioContext cannot chirp). Without granted permission the vibrate/chirp/
 * flash trio below is the whole alert, exactly as before.
 */

// Untranslated like FLASH_TITLE below: this module runs outside any intl
// provider, and threading a translator through the logger's stable
// onRestOver reference is its own change.
const NOTIFICATION_TITLE = 'Rest over'
const NOTIFICATION_BODY = 'Time for the next set.'

/** One tag for post AND cancel: a later rest period replaces an unswiped
 *  earlier notification (never stacks), and the cancel path closes exactly
 *  ours without touching workout-reminder pushes. */
const REST_OVER_NOTIFICATION_TAG = 'rest-over'

const FLASH_TITLE = 'REST OVER'

export function fireRestOverAlert(): void {
  vibrate(REST_OVER_VIBRATION)
  playRestChime()
  flashTitle()
  postRestOverNotification()
}

/**
 * Closes any posted rest-over notification. The logger calls this when the
 * session moves past the notification — skip, the next set's check-off, and
 * the logger unmounting (finish/close/abandon) — because a stale "Rest over"
 * on the lock screen after the user is already lifting again (or done) is
 * noise, not signal. Best-effort: a failure leaves nothing worse than a
 * user-dismissible notification.
 */
export function clearRestOverNotification(): void {
  if (!canUseRestOverNotifications()) return
  void (async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) return
    const notifications = await registration.getNotifications({
      tag: REST_OVER_NOTIFICATION_TAG,
    })
    for (const notification of notifications) notification.close()
  })().catch(() => {
    // Cleanup is garnish too — it must never reach the session.
  })
}

/**
 * Support + permission gate. Deliberately CHECKS, never requests — this
 * module must be incapable of prompting; permission granted elsewhere (the
 * /settings opt-in) is the only way notifications turn on here.
 */
function canUseRestOverNotifications(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false
  if (!('Notification' in window)) return false
  return window.Notification.permission === 'granted'
}

/**
 * The locked/backgrounded channel, visibility-gated like the title flash: a
 * visible app already shows the volt "+overage" readout (and the trio just
 * fired), so a banner on top would double-alert. getRegistration (not
 * .ready) so environments that never register a worker — dev builds — get
 * undefined and fall through instead of hanging forever.
 */
function postRestOverNotification(): void {
  if (!canUseRestOverNotifications()) return
  if (document.visibilityState === 'visible') return
  void (async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) return
    await registration.showNotification(NOTIFICATION_TITLE, {
      body: NOTIFICATION_BODY,
      icon: '/icons/icon-192.png',
      tag: REST_OVER_NOTIFICATION_TAG,
      // focusExisting: the SW click handler must FOCUS a live logger, never
      // navigate it — a navigation would reload the page and drop in-memory
      // session state (the running rest period, the undo stack). `url` is
      // the cold-start destination when no window exists at all; the draft
      // restore rebuilds the sets there.
      data: { url: '/workout/new', focusExisting: true },
    })
  })().catch(() => {
    // The trio above already fired — a notification failure stays silent.
  })
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
