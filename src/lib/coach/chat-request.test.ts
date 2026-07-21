import { describe, it, expect } from 'vitest'
import {
  MAX_MESSAGE_BYTES,
  MAX_MESSAGES,
  parseChatMessage,
  parseChatMessages,
  parseStoredChatMessages,
} from './chat-request'

const userMessage = (text: string) => ({
  id: 'm1',
  role: 'user',
  parts: [{ type: 'text', text }],
})

describe('parseChatMessages', () => {
  it('accepts a well-formed conversation', () => {
    const result = parseChatMessages([userMessage('hello')])
    expect(result.ok).toBe(true)
  })

  it('rejects non-arrays and empty arrays', () => {
    expect(parseChatMessages(undefined).ok).toBe(false)
    expect(parseChatMessages('hi').ok).toBe(false)
    expect(parseChatMessages([]).ok).toBe(false)
  })

  it('rejects conversations past the message cap', () => {
    const result = parseChatMessages(
      Array.from({ length: MAX_MESSAGES + 1 }, () => userMessage('x')),
    )
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects a bad role, naming the index', () => {
    const result = parseChatMessages([userMessage('ok'), { role: 'tool', parts: [] }])
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('index 1') })
  })

  it('rejects missing or non-array parts', () => {
    expect(parseChatMessages([{ role: 'user' }]).ok).toBe(false)
    expect(parseChatMessages([{ role: 'user', parts: 'hi' }]).ok).toBe(false)
  })

  it('rejects a text part without string text', () => {
    expect(parseChatMessages([{ role: 'user', parts: [{ type: 'text', text: 42 }] }]).ok).toBe(
      false,
    )
  })

  it('rejects parts without a type and non-object entries', () => {
    expect(parseChatMessages([{ role: 'user', parts: [{}] }]).ok).toBe(false)
    expect(parseChatMessages(['hello']).ok).toBe(false)
    expect(parseChatMessages([{ role: 'user', parts: [null] }]).ok).toBe(false)
  })

  it('allows unknown non-text part types (tool parts round-trip untouched)', () => {
    const result = parseChatMessages([
      {
        role: 'assistant',
        parts: [{ type: 'dynamic-tool', toolCallId: 'x', state: 'output-available' }],
      },
    ])
    expect(result.ok).toBe(true)
  })
})

describe('parseChatMessage', () => {
  it('accepts a well-formed single message', () => {
    const result = parseChatMessage(userMessage('hello'))
    expect(result).toMatchObject({ ok: true })
  })

  it('rejects non-objects and bad shapes', () => {
    expect(parseChatMessage(undefined).ok).toBe(false)
    expect(parseChatMessage([userMessage('hi')]).ok).toBe(false)
    expect(parseChatMessage({ role: 'tool', parts: [] }).ok).toBe(false)
    expect(parseChatMessage({ role: 'user', parts: 'hi' }).ok).toBe(false)
    expect(parseChatMessage({ role: 'user', parts: [{ type: 'text', text: 42 }] }).ok).toBe(false)
  })

  it('rejects a message over the per-message byte cap', () => {
    const result = parseChatMessage(userMessage('x'.repeat(MAX_MESSAGE_BYTES)))
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('too large') })
  })
})

describe('parseStoredChatMessages', () => {
  it('accepts threads past the request-path message cap (load tolerance)', () => {
    const result = parseStoredChatMessages(
      Array.from({ length: MAX_MESSAGES + 10 }, () => userMessage('x')),
    )
    expect(result).toMatchObject({ ok: true })
  })

  it('accepts an empty stored thread', () => {
    expect(parseStoredChatMessages([]).ok).toBe(true)
  })

  it('still rejects malformed entries and non-arrays', () => {
    expect(parseStoredChatMessages([{ nope: true }]).ok).toBe(false)
    expect(parseStoredChatMessages('junk').ok).toBe(false)
  })
})
