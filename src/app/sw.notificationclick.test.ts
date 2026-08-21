import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pins the notificationclick contract, which now serves TWO producers with
 * different needs: workout-reminder pushes (data.url only) must keep their
 * shipped navigate-then-focus behavior, while the logger's local rest-over
 * banner (data.focusExisting) must get focus WITHOUT navigation — a
 * navigation would reload the live logger and drop in-memory session state.
 * The worker module registers its listeners at import, so the harness stubs
 * `self` first, imports once, and replays the captured handler per test.
 */

vi.mock('serwist', () => ({
  Serwist: class {
    addEventListeners() {}
  },
}))

type Handler = (event: {
  notification: { close: () => void; data: unknown }
  waitUntil: (p: Promise<unknown>) => void
}) => void

const handlers = new Map<string, Handler>()

const matchAll = vi.fn()
const openWindow = vi.fn()

function makeClient() {
  const client = {
    focus: vi.fn(),
    navigate: vi.fn(),
  }
  client.focus.mockResolvedValue(client)
  client.navigate.mockResolvedValue(client)
  return client
}

/** Dispatch a click with the given notification data; resolves when the
 *  handler's waitUntil chain settles. */
async function click(data: unknown) {
  const close = vi.fn()
  let settled: Promise<unknown> = Promise.resolve()
  handlers.get('notificationclick')!({
    notification: { close, data },
    waitUntil: (p) => {
      settled = p
    },
  })
  await settled
  return { close }
}

beforeAll(async () => {
  vi.stubGlobal('self', {
    __SW_MANIFEST: [],
    addEventListener: (type: string, handler: Handler) => {
      handlers.set(type, handler)
    },
    clients: { matchAll, openWindow },
  })
  await import('./sw')
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  matchAll.mockReset()
  openWindow.mockReset()
})

describe('sw notificationclick', () => {
  it('push-reminder data (url only) keeps the shipped path: navigate the existing client, then focus', async () => {
    // Arrange — a workout-reminder push sets data: { url } and nothing else
    const client = makeClient()
    matchAll.mockResolvedValue([client])

    // Act
    const { close } = await click({ url: '/workout/plan' })

    // Assert
    expect(close).toHaveBeenCalledTimes(1)
    expect(matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true })
    expect(client.navigate).toHaveBeenCalledWith('/workout/plan')
    expect(client.focus).toHaveBeenCalledTimes(1)
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('focusExisting data (the rest-over banner) focuses the live client and NEVER navigates it', async () => {
    // Arrange
    const client = makeClient()
    matchAll.mockResolvedValue([client])

    // Act
    await click({ url: '/workout/new', focusExisting: true })

    // Assert — no navigation means no reload, so the logger's in-memory
    // session (running rest period, undo stack) survives the tap.
    expect(client.focus).toHaveBeenCalledTimes(1)
    expect(client.navigate).not.toHaveBeenCalled()
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('cold start (no window client) opens the url — focusExisting changes nothing there', async () => {
    // Arrange
    matchAll.mockResolvedValue([])

    // Act
    await click({ url: '/workout/new', focusExisting: true })

    // Assert — the draft restore rebuilds the session at the destination.
    expect(openWindow).toHaveBeenCalledWith('/workout/new')
  })

  it("malformed data falls back to '/' exactly as before the focusExisting parse", async () => {
    // Arrange
    matchAll.mockResolvedValue([])

    // Act — a push with no/garbage data must still land somewhere
    await click(undefined)

    // Assert
    expect(openWindow).toHaveBeenCalledWith('/')
  })

  it('a truthy-but-not-true focusExisting is ignored — the flag is an exact boolean contract', async () => {
    // Arrange — hostile/legacy data shapes must not strand the user on the
    // wrong page by suppressing navigation.
    const client = makeClient()
    matchAll.mockResolvedValue([client])

    // Act
    await click({ url: '/workout/plan', focusExisting: 'yes' })

    // Assert — falls through to the navigate path.
    expect(client.navigate).toHaveBeenCalledWith('/workout/plan')
    expect(client.focus).toHaveBeenCalledTimes(1)
  })
})
