import { describe, it, expect } from 'vitest'
import { parsePushPayload } from './push-payload'

describe('parsePushPayload', () => {
  it('passes a well-formed payload through', () => {
    // Arrange
    const raw = { title: 'Legs — Week 3', body: '5 exercises · tap to start', url: '/' }

    // Act
    const payload = parsePushPayload(raw)

    // Assert
    expect(payload).toEqual(raw)
  })

  it('keeps a same-origin path url', () => {
    expect(parsePushPayload({ title: 't', body: 'b', url: '/workout/new' })?.url).toBe(
      '/workout/new',
    )
  })

  it('falls back to / for a missing url', () => {
    expect(parsePushPayload({ title: 't', body: 'b' })?.url).toBe('/')
  })

  it('falls back to / for an external or protocol-relative url', () => {
    expect(parsePushPayload({ title: 't', body: 'b', url: 'https://evil.example' })?.url).toBe('/')
    expect(parsePushPayload({ title: 't', body: 'b', url: '//evil.example' })?.url).toBe('/')
  })

  it('rejects payloads without title or body', () => {
    expect(parsePushPayload({ body: 'b' })).toBeNull()
    expect(parsePushPayload({ title: 't' })).toBeNull()
    expect(parsePushPayload({ title: '', body: 'b' })).toBeNull()
  })

  it('rejects non-object data', () => {
    expect(parsePushPayload(null)).toBeNull()
    expect(parsePushPayload('text')).toBeNull()
    expect(parsePushPayload(undefined)).toBeNull()
  })

  it('rejects oversized text', () => {
    expect(parsePushPayload({ title: 'a'.repeat(600), body: 'b' })).toBeNull()
  })
})
