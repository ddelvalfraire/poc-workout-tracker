import { describe, it, expect } from 'vitest'
import type { UIMessage } from 'ai'
import { reconcileThread } from './chat-thread'

const user = (id: string, text = 'hi'): UIMessage =>
  ({ id, role: 'user', parts: [{ type: 'text', text }] }) as UIMessage

const assistant = (id: string, text = 'ok'): UIMessage =>
  ({ id, role: 'assistant', parts: [{ type: 'text', text }] }) as UIMessage

describe('reconcileThread', () => {
  it('appends a user tail to the stored thread', () => {
    const result = reconcileThread([user('u1'), assistant('a1')], user('u2'))
    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2'])
    }
  })

  it('appends a user tail to an empty store (first-ever message)', () => {
    const result = reconcileThread([], user('u1'))
    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.messages).toHaveLength(1)
  })

  it('replaces the stored tail on a matching assistant id (approval continuation)', () => {
    const updated = assistant('a1', 'now with approval responses')
    const result = reconcileThread([user('u1'), assistant('a1')], updated)
    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.messages).toHaveLength(2)
      expect(result.messages[1]).toBe(updated)
    }
  })

  it('rejects an assistant tail when the store is empty', () => {
    expect(reconcileThread([], assistant('a1'))).toMatchObject({ ok: false })
  })

  it('rejects an assistant tail whose id does not match the stored tail', () => {
    expect(reconcileThread([user('u1'), assistant('a1')], assistant('a2'))).toMatchObject({
      ok: false,
    })
  })

  it('rejects an assistant tail when the stored tail is a user message', () => {
    expect(reconcileThread([user('a1')], assistant('a1'))).toMatchObject({ ok: false })
  })

  it('rejects a system tail', () => {
    const system = { id: 's1', role: 'system', parts: [] } as unknown as UIMessage
    expect(reconcileThread([user('u1')], system)).toMatchObject({ ok: false })
  })

  it('does not mutate the stored array', () => {
    const stored = [user('u1')]
    reconcileThread(stored, user('u2'))
    expect(stored).toHaveLength(1)
  })
})
