import { describe, it, expect } from 'vitest'
import { safeReturnPath } from './safe-return-path'

describe('safeReturnPath', () => {
  it('keeps the share-page paths the acquisition funnel depends on', () => {
    // Arrange / Act / Assert — these are the real callers: a signed-out
    // visitor on a shared link must land back on that link after signing in.
    expect(safeReturnPath('/p/tok_abcdefghijklmnop')).toBe('/p/tok_abcdefghijklmnop')
    expect(safeReturnPath('/w/tok_abcdefghijklmnop')).toBe('/w/tok_abcdefghijklmnop')
    expect(safeReturnPath('/workout/new?from=share')).toBe('/workout/new?from=share')
  })

  it('falls back home when nothing was asked for', () => {
    expect(safeReturnPath(null)).toBe('/')
    expect(safeReturnPath(undefined)).toBe('/')
    expect(safeReturnPath('')).toBe('/')
  })

  it.each([
    ['https://evil.example/steal', 'absolute off-site URL'],
    ['//evil.example/steal', 'protocol-relative, resolves off-site'],
    ['/\\evil.example', 'backslash after the slash, read as // by some browsers'],
    ['/path\\to\\thing', 'backslashes invite host/path confusion'],
    ['javascript:alert(1)', 'script URL'],
    ['http://evil.example', 'plain absolute'],
  ])('refuses %s (%s)', (input) => {
    // Someone who just authenticated is at peak trust; bouncing them off-site
    // at that moment is the whole point of an open-redirect attack.
    expect(safeReturnPath(input)).toBe('/')
  })

  it('refuses control characters that could split a downstream header', () => {
    expect(safeReturnPath('/p/tok\nLocation: https://evil.example')).toBe('/')
    expect(safeReturnPath('/p/tok\r\nSet-Cookie: x=1')).toBe('/')
  })
})
