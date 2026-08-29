import { isNoteAnchorKind, type NoteAnchor } from '@/lib/notes/note-input'

/**
 * Offline resilience for in-session note creation (notes v2, PWA rules): a
 * pending-notes queue persisted to localStorage that flushes on reconnect.
 * Unlike draft-sync's last-write-wins snapshot, notes are APPEND-ONLY facts —
 * every queued note must eventually land, in order, exactly once per queue
 * entry — so this is a FIFO drain, not a newest-snapshot sender.
 *
 * Exactly-once: `send` must forward `PendingNote.id` as the create's
 * `clientKey` (createNoteAction's third arg) — the server's partial unique
 * on (user_id, client_key) dedupes a replayed flush (send landed, response
 * lost, note re-sent) into the one existing row.
 *
 * Pure logic with injectable storage and sender (the logger supplies
 * localStorage access and the createNote server action), so the whole state
 * machine unit-tests as plain functions — the draft-sync.ts idiom. The codec
 * is a trust boundary in the spirit of draft-payload's `isDraftPayload`:
 * whatever comes back out of localStorage is re-validated field-by-field and
 * malformed entries are dropped rather than sent.
 */

export const PENDING_NOTES_VERSION = 1

/** One localStorage key per browser; the queue is not per-workout — a note's
 *  anchor already addresses its target, and a flush after navigation away
 *  from the logger must still deliver. */
export const PENDING_NOTES_STORAGE_KEY = 'pending-notes-v1'

/** A note captured while offline, waiting to be sent. `id` is a client uuid
 *  (dedupe/removal handle only — never persisted server-side); `createdAt`
 *  is ISO, informational for a future "pending" UI. */
export interface PendingNote {
  id: string
  anchor: NoteAnchor
  body: string
  createdAt: string
}

/** The JSON shape stored under PENDING_NOTES_STORAGE_KEY. */
export interface PendingNotesPayload {
  v: number
  notes: PendingNote[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Field-walk guard for one queued note (the isDraftSet idiom). */
export function isPendingNote(value: unknown): value is PendingNote {
  if (!value || typeof value !== 'object') return false
  const note = value as Record<string, unknown>
  const anchor = note.anchor as Record<string, unknown> | null | undefined
  return (
    typeof note.id === 'string' &&
    typeof note.body === 'string' &&
    note.body.trim().length > 0 &&
    typeof note.createdAt === 'string' &&
    !Number.isNaN(new Date(note.createdAt).getTime()) &&
    !!anchor &&
    typeof anchor === 'object' &&
    isNoteAnchorKind(anchor.kind) &&
    typeof anchor.id === 'string' &&
    UUID_RE.test(anchor.id)
  )
}

/** Builds the storable payload. */
export function buildPendingNotesPayload(notes: PendingNote[]): PendingNotesPayload {
  return { v: PENDING_NOTES_VERSION, notes }
}

/**
 * Parses an untrusted stored payload into the queue, or `[]` when it can't
 * be trusted at all. Individually malformed entries are DROPPED (a corrupt
 * entry must not wedge the queue and block every note behind it); anything
 * well-formed still sends.
 */
export function parsePendingNotes(raw: unknown): PendingNote[] {
  if (typeof raw !== 'string' || raw.trim() === '') return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return []
  }
  if (!value || typeof value !== 'object') return []
  const payload = value as Record<string, unknown>
  if (payload.v !== PENDING_NOTES_VERSION || !Array.isArray(payload.notes)) return []
  return payload.notes.filter(isPendingNote)
}

export interface PendingNotesQueue {
  /** Persist a note and attempt to send immediately (it may be online). */
  enqueue(note: PendingNote): void
  /** Drain the queue FIFO — the reconnect (`online`) handler calls this. */
  flush(): Promise<void>
  /** Currently queued notes (from storage, validated). */
  pending(): PendingNote[]
}

/**
 * The queue state machine. `load`/`store` wrap localStorage (injected so
 * tests — and the SSR-safe logger — control the medium); `send` is the
 * createNote server action. One flush drains sequentially and STOPS on the
 * first failure, keeping that note and everything behind it queued for the
 * next flush — a dead zone can't silently eat a note, and order is kept.
 * `onStatus` reports the queued count after every transition (0 = synced).
 */
export function createPendingNotesQueue(opts: {
  load: () => string | null
  store: (raw: string | null) => void
  send: (note: PendingNote) => Promise<void>
  onStatus?: (pendingCount: number) => void
}): PendingNotesQueue {
  // The current drain, or null. A flush during a drain JOINS it (returns the
  // same promise) instead of racing a second sender — one in-flight, ever.
  let inFlight: Promise<void> | null = null
  // In-memory mirror of the queue, authoritative once the first write lands.
  // localStorage persistence is BEST-EFFORT: a quota/serialization failure
  // must not lose the note (memory keeps it; every later write retries the
  // store) — it only loses reload durability until a store succeeds.
  let memory: PendingNote[] | null = null

  function read(): PendingNote[] {
    return memory ?? parsePendingNotes(opts.load())
  }

  function write(notes: PendingNote[]): void {
    memory = notes
    try {
      // An empty queue removes the key entirely — no stale payloads linger.
      opts.store(notes.length === 0 ? null : JSON.stringify(buildPendingNotesPayload(notes)))
    } catch {
      // Quota exceeded (or storage unavailable): fail soft — the in-memory
      // queue is intact and the drain path re-attempts persistence on its
      // next write.
    }
    opts.onStatus?.(notes.length)
  }

  async function drain(): Promise<void> {
    let queue = read()
    while (queue.length > 0) {
      const [head] = queue
      try {
        await opts.send(head)
      } catch {
        // Offline (or the server refused): stop here, keep head + tail for
        // the next flush. A validation refusal will retry too — accepted:
        // the codec already screens shape, and dropping on error risks
        // eating words over a transient 500.
        return
      }
      // Re-read before removing: an enqueue during the await must not be
      // lost by writing back a stale snapshot.
      queue = read().filter((n) => n.id !== head.id)
      write(queue)
    }
  }

  function flush(): Promise<void> {
    if (inFlight) return inFlight
    inFlight = drain().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return {
    enqueue(note) {
      write([...read(), note])
      void flush()
    },
    flush,
    pending: read,
  }
}
