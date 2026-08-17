import { describe, it, expect, vi } from 'vitest'
import {
  PENDING_NOTES_VERSION,
  buildPendingNotesPayload,
  createPendingNotesQueue,
  isPendingNote,
  parsePendingNotes,
  type PendingNote,
} from './pending-notes'

const ANCHOR_ID = '01234567-89ab-cdef-0123-456789abcdef'

function note(id: string, body = 'left shoulder clicked'): PendingNote {
  return {
    id,
    anchor: { kind: 'set', id: ANCHOR_ID },
    body,
    createdAt: '2026-08-17T00:00:00.000Z',
  }
}

/** In-memory localStorage stand-in wired to a queue. */
function makeHarness(send: (n: PendingNote) => Promise<void>) {
  let stored: string | null = null
  const statuses: number[] = []
  const queue = createPendingNotesQueue({
    load: () => stored,
    store: (raw) => {
      stored = raw
    },
    send,
    onStatus: (count) => statuses.push(count),
  })
  return {
    queue,
    statuses,
    get stored() {
      return stored
    },
  }
}

describe('codec', () => {
  it('round-trips a payload through build/parse', () => {
    const raw = JSON.stringify(buildPendingNotesPayload([note('a'), note('b')]))
    expect(parsePendingNotes(raw)).toEqual([note('a'), note('b')])
  })

  it('rejects junk wholesale: non-JSON, wrong version, wrong shape', () => {
    expect(parsePendingNotes(null)).toEqual([])
    expect(parsePendingNotes('not json {')).toEqual([])
    expect(parsePendingNotes(JSON.stringify({ v: 999, notes: [note('a')] }))).toEqual([])
    expect(parsePendingNotes(JSON.stringify({ v: PENDING_NOTES_VERSION, notes: 'x' }))).toEqual([])
  })

  it('drops individually malformed entries but keeps the valid ones', () => {
    const raw = JSON.stringify({
      v: PENDING_NOTES_VERSION,
      notes: [
        note('good'),
        { ...note('bad-anchor'), anchor: { kind: 'set', id: 'not-a-uuid' } },
        { ...note('bad-body'), body: '   ' },
        { ...note('bad-date'), createdAt: 'yesterday-ish' },
      ],
    })
    expect(parsePendingNotes(raw)).toEqual([note('good')])
  })

  it('isPendingNote validates the full field walk', () => {
    expect(isPendingNote(note('a'))).toBe(true)
    expect(isPendingNote({ ...note('a'), anchor: { kind: 'exercise', id: ANCHOR_ID } })).toBe(false)
    expect(isPendingNote({ ...note('a'), id: 42 })).toBe(false)
    expect(isPendingNote(null)).toBe(false)
  })
})

describe('createPendingNotesQueue', () => {
  it('enqueue persists then sends immediately when online, emptying storage', async () => {
    const sent: string[] = []
    const h = makeHarness(async (n) => {
      sent.push(n.id)
    })

    h.queue.enqueue(note('a'))
    await h.queue.flush()

    expect(sent).toEqual(['a'])
    expect(h.stored).toBeNull() // empty queue removes the key
    expect(h.statuses.at(-1)).toBe(0)
  })

  it('keeps the note queued when the send fails (gym dead zone)', async () => {
    const h = makeHarness(async () => {
      throw new Error('offline')
    })

    h.queue.enqueue(note('a'))
    await h.queue.flush()

    expect(h.queue.pending()).toEqual([note('a')])
    expect(h.statuses.at(-1)).toBe(1)
  })

  it('drains FIFO on reconnect and stops at the first failure, preserving order', async () => {
    let failOn: string | null = 'b'
    const sent: string[] = []
    const h = makeHarness(async (n) => {
      if (n.id === failOn) throw new Error('offline again')
      sent.push(n.id)
    })

    h.queue.enqueue(note('a'))
    h.queue.enqueue(note('b'))
    h.queue.enqueue(note('c'))
    await h.queue.flush()

    // a sent; b failed; c must still be BEHIND b, untouched.
    expect(sent).toEqual(['a'])
    expect(h.queue.pending().map((n) => n.id)).toEqual(['b', 'c'])

    // Reconnect: the online handler flushes and the rest drains in order.
    failOn = null
    await h.queue.flush()
    expect(sent).toEqual(['a', 'b', 'c'])
    expect(h.queue.pending()).toEqual([])
  })

  it('does not lose a note enqueued while a flush is mid-send', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    const sent: string[] = []
    const h = makeHarness(async (n) => {
      sent.push(n.id)
      if (n.id === 'a') await gate
    })

    h.queue.enqueue(note('a'))
    const drain = h.queue.flush()
    h.queue.enqueue(note('b')) // lands while 'a' is on the wire
    release()
    await drain
    await h.queue.flush()

    expect(sent).toEqual(['a', 'b'])
    expect(h.queue.pending()).toEqual([])
  })

  it('ignores a second flush while one is draining (single in-flight)', async () => {
    const send = vi.fn(async () => {})
    const h = makeHarness(send)
    h.queue.enqueue(note('a'))
    await Promise.all([h.queue.flush(), h.queue.flush()])
    expect(send).toHaveBeenCalledTimes(1)
  })
})
