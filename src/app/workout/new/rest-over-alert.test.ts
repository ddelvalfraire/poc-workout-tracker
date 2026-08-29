import { afterEach, describe, expect, it, vi } from 'vitest'
import { REST_OVER_VIBRATION } from '@/lib/workout/rest-alert'
import { clearRestOverNotification, fireRestOverAlert } from './rest-over-alert'

/**
 * Node-env harness in the back-navigation stubGlobal idiom: the module reads
 * window/document/navigator at call time, so stubbing the globals IS the
 * harness — no jsdom needed. Permission is only ever STUBBED as a value;
 * asserting getRegistration stays untouched in the non-granted cases is the
 * proof the module neither posts nor prompts without pre-granted permission.
 */

function stubBrowser({
  permission = 'granted',
  visibility = 'hidden',
  hasRegistration = true,
}: {
  permission?: NotificationPermission
  visibility?: DocumentVisibilityState
  hasRegistration?: boolean
} = {}) {
  const close = vi.fn()
  const showNotification = vi.fn().mockResolvedValue(undefined)
  // Two posted notifications on getNotifications: cancel must close ALL of
  // them, not just the first (belt over the tag's replace semantics).
  const getNotifications = vi.fn().mockResolvedValue([{ close }, { close }])
  const registration = { showNotification, getNotifications }
  const getRegistration = vi
    .fn()
    .mockResolvedValue(hasRegistration ? registration : undefined)
  const doc = {
    visibilityState: visibility,
    title: 'Workout',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  const vibrate = vi.fn()
  vi.stubGlobal('window', {
    Notification: { permission },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  vi.stubGlobal('document', doc)
  vi.stubGlobal('navigator', { vibrate, serviceWorker: { getRegistration } })
  return { showNotification, getNotifications, getRegistration, close, vibrate, doc }
}

/** Settle the fire-and-forget chain behind the sync API (one macrotask). */
const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fireRestOverAlert notification path', () => {
  it('posts a tagged local notification through the SW when permission is already granted', async () => {
    // Arrange
    const { showNotification } = stubBrowser()

    // Act
    fireRestOverAlert()
    await flushAsync()

    // Assert
    expect(showNotification).toHaveBeenCalledTimes(1)
    expect(showNotification).toHaveBeenCalledWith('Rest over', {
      body: 'Time for the next set.',
      icon: '/icons/icon-192.png',
      tag: 'rest-over',
      data: { url: '/workout/new', focusExisting: true },
    })
  })

  it('keeps the vibration firing alongside the notification — a complement, not a replacement', async () => {
    const { vibrate } = stubBrowser()

    fireRestOverAlert()
    await flushAsync()

    expect(vibrate).toHaveBeenCalledWith(REST_OVER_VIBRATION)
  })

  it("stays silent on 'default' permission and falls back to the trio", async () => {
    const { getRegistration, showNotification, vibrate, doc } = stubBrowser({
      permission: 'default',
    })

    fireRestOverAlert()
    await flushAsync()

    // Never even reaches for the worker — and NEVER prompts (the module has
    // no requestPermission path at all; this pins the no-post half).
    expect(getRegistration).not.toHaveBeenCalled()
    expect(showNotification).not.toHaveBeenCalled()
    // The pre-existing alert still fired: vibration and the hidden-tab flash.
    expect(vibrate).toHaveBeenCalledWith(REST_OVER_VIBRATION)
    expect(doc.title).toBe('REST OVER')
  })

  it("stays silent on 'denied' permission and falls back to the trio", async () => {
    const { getRegistration, showNotification, vibrate, doc } = stubBrowser({
      permission: 'denied',
    })

    fireRestOverAlert()
    await flushAsync()

    expect(getRegistration).not.toHaveBeenCalled()
    expect(showNotification).not.toHaveBeenCalled()
    expect(vibrate).toHaveBeenCalledWith(REST_OVER_VIBRATION)
    expect(doc.title).toBe('REST OVER')
  })

  it('never posts while the app is visible — the in-app overage readout owns that moment', async () => {
    const { getRegistration, showNotification, vibrate } = stubBrowser({
      visibility: 'visible',
    })

    fireRestOverAlert()
    await flushAsync()

    expect(getRegistration).not.toHaveBeenCalled()
    expect(showNotification).not.toHaveBeenCalled()
    // The foreground alert is unchanged.
    expect(vibrate).toHaveBeenCalledWith(REST_OVER_VIBRATION)
  })

  it('tolerates a missing registration (dev builds never register a worker)', async () => {
    const { showNotification } = stubBrowser({ hasRegistration: false })

    fireRestOverAlert()
    await flushAsync()

    expect(showNotification).not.toHaveBeenCalled()
  })
})

describe('clearRestOverNotification (the skip / next-set cancel)', () => {
  it('closes every posted rest-over notification, matched by tag', async () => {
    // Arrange
    const { getNotifications, close } = stubBrowser()

    // Act
    clearRestOverNotification()
    await flushAsync()

    // Assert — only OUR tag is queried (workout-reminder pushes untouched),
    // and both stacked instances close.
    expect(getNotifications).toHaveBeenCalledWith({ tag: 'rest-over' })
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('touches nothing without granted permission — nothing could have posted', async () => {
    const { getRegistration } = stubBrowser({ permission: 'default' })

    clearRestOverNotification()
    await flushAsync()

    expect(getRegistration).not.toHaveBeenCalled()
  })

  it('tolerates a missing registration', async () => {
    const { close } = stubBrowser({ hasRegistration: false })

    clearRestOverNotification()
    await flushAsync()

    expect(close).not.toHaveBeenCalled()
  })
})
