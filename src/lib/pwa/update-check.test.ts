import { describe, it, expect } from 'vitest'
import {
  isUpdateAvailable,
  isProtectedPath,
  shouldCheckNow,
  shouldReloadForUpdate,
  parseReloadStamp,
  VERSION_CHECK_MIN_INTERVAL_MS,
  UPDATE_RELOAD_COOLDOWN_MS,
} from './update-check'

describe('isUpdateAvailable', () => {
  it('is true only when both ids exist and differ', () => {
    expect(isUpdateAvailable('abc', 'def')).toBe(true)
    expect(isUpdateAvailable('abc', 'abc')).toBe(false)
  })

  it('is false when either side is missing or not a string (never reload blind)', () => {
    expect(isUpdateAvailable(undefined, 'def')).toBe(false)
    expect(isUpdateAvailable('', 'def')).toBe(false)
    expect(isUpdateAvailable('abc', null)).toBe(false)
    expect(isUpdateAvailable('abc', undefined)).toBe(false)
    expect(isUpdateAvailable('abc', '')).toBe(false)
    expect(isUpdateAvailable('abc', 42)).toBe(false)
  })
})

describe('isProtectedPath', () => {
  it('protects the live logger surfaces (quick log and edit mode)', () => {
    expect(isProtectedPath('/workout/new')).toBe(true)
    expect(isProtectedPath('/workout/1f9a4c92-aaaa-4bbb-8ccc-123456789abc/edit')).toBe(true)
  })

  it('leaves read-only and non-logger routes reloadable', () => {
    expect(isProtectedPath('/')).toBe(false)
    expect(isProtectedPath('/programs')).toBe(false)
    expect(isProtectedPath('/workout/1f9a4c92-aaaa-4bbb-8ccc-123456789abc')).toBe(false)
    expect(isProtectedPath('/settings')).toBe(false)
  })
})

describe('shouldReloadForUpdate (reload-loop guard)', () => {
  const NOW = 1_000_000

  it('allows the first reload for a mismatch (no prior stamp)', () => {
    expect(shouldReloadForUpdate(null, 'sha-new', NOW)).toBe(true)
  })

  it('refuses a repeat reload for the SAME deployed id within the cooldown', () => {
    // Mid-deploy CDN skew: reload landed on a stale edge, mismatch persists —
    // must degrade to stale-but-usable, not a reload loop.
    const stamp = { buildId: 'sha-new', at: NOW }

    expect(shouldReloadForUpdate(stamp, 'sha-new', NOW + UPDATE_RELOAD_COOLDOWN_MS - 1)).toBe(false)
  })

  it('allows another attempt for the same id once the cooldown elapses', () => {
    const stamp = { buildId: 'sha-new', at: NOW }

    expect(shouldReloadForUpdate(stamp, 'sha-new', NOW + UPDATE_RELOAD_COOLDOWN_MS)).toBe(true)
  })

  it('allows an immediate reload when a NEWER deploy shows up', () => {
    // A fresh target id is a new deploy, not the same wedged one.
    const stamp = { buildId: 'sha-new', at: NOW }

    expect(shouldReloadForUpdate(stamp, 'sha-newer', NOW + 1)).toBe(true)
  })
})

describe('parseReloadStamp', () => {
  it('round-trips a valid stamp', () => {
    const raw = JSON.stringify({ buildId: 'sha', at: 123 })

    expect(parseReloadStamp(raw)).toEqual({ buildId: 'sha', at: 123 })
  })

  it('returns null for missing, malformed, or wrong-shaped values', () => {
    expect(parseReloadStamp(null)).toBeNull()
    expect(parseReloadStamp('not json')).toBeNull()
    expect(parseReloadStamp('{}')).toBeNull()
    expect(parseReloadStamp(JSON.stringify({ buildId: 42, at: 'x' }))).toBeNull()
  })
})

describe('shouldCheckNow', () => {
  it('always checks when never checked before', () => {
    expect(shouldCheckNow(null, 1_000_000)).toBe(true)
  })

  it('throttles within the interval and allows at the boundary', () => {
    const last = 1_000_000
    expect(shouldCheckNow(last, last + VERSION_CHECK_MIN_INTERVAL_MS - 1)).toBe(false)
    expect(shouldCheckNow(last, last + VERSION_CHECK_MIN_INTERVAL_MS)).toBe(true)
  })
})
