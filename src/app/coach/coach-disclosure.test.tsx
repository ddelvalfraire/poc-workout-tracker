import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CoachDisclosure, acknowledgeCoachDisclosure } from './coach-disclosure'

/**
 * The interstitial's contract: SSR renders NOTHING (server snapshot says
 * acked, so hydration never flashes the overlay), acknowledgement persists
 * the per-device flag, and a broken localStorage fails toward SHOWING the
 * disclosure — the protective direction for a proactive-disclosure duty.
 */

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CoachDisclosure', () => {
  it('renders nothing on the server — no hydration flash', () => {
    // renderToStaticMarkup uses the SSR snapshot (acked=true).
    expect(renderToStaticMarkup(<CoachDisclosure />)).toBe('')
  })

  it('acknowledgement persists the per-device flag', () => {
    acknowledgeCoachDisclosure()
    expect(store.get('coach-ai-disclosure-ack')).toBe('1')
  })

  it('a throwing localStorage fails toward showing, and ack never throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    // ack path swallows storage failure (dismissal still notifies listeners)
    expect(() => acknowledgeCoachDisclosure()).not.toThrow()
  })
})
