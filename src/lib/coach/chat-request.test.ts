import { describe, it, expect } from 'vitest'
import { MAX_MESSAGES, parseChatMessages } from './chat-request'

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
