import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createNoteAction,
  createSetNotesForWorkoutAction,
  createFallbackSetNoteAction,
  updateNoteAction,
  deleteNoteAction,
  listNotesAction,
} from './actions'
import { requireUserId } from '@/lib/auth/auth'
import {
  createNote,
  createPositionalSetNote,
  createWorkoutFallbackNote,
  updateNote,
  deleteNote,
  listNotes,
} from '@/db/notes'

/**
 * Action-layer tests for the notes-v2 control flow (the workout/actions.test.ts
 * idiom): the db helpers are the authorization boundary and are unit-tested in
 * db/notes.test.ts; here we mock them and assert validation, the not-found →
 * throw translation, and that NOTHING revalidates (the #214 live-session rule).
 */

vi.mock('@/lib/auth/auth', () => ({ requireUserId: vi.fn() }))
vi.mock('@/db/notes', () => ({
  createNote: vi.fn(),
  createPositionalSetNote: vi.fn(),
  createWorkoutFallbackNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  listNotes: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { revalidatePath } from 'next/cache'

const USER = 'user_123'
const UUID = '01234567-89ab-cdef-0123-456789abcdef'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireUserId).mockResolvedValue(USER)
})

describe('createNoteAction', () => {
  it('validates and creates on an owned anchor, without revalidating', async () => {
    const row = { id: 'n1' }
    vi.mocked(createNote).mockResolvedValue(row as never)

    const result = await createNoteAction({ kind: 'set', id: UUID }, '  shoulder clicked  ')

    expect(result).toBe(row)
    expect(createNote).toHaveBeenCalledWith(USER, { kind: 'set', id: UUID }, 'shoulder clicked', {})
    // The live-session rule: a note save must never re-render the logger.
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('throws when the anchor is not owned (db returns null)', async () => {
    vi.mocked(createNote).mockResolvedValue(null)
    await expect(createNoteAction({ kind: 'workout', id: UUID }, 'x')).rejects.toThrow(/not found/)
  })

  it('lower-cases and forwards a clientKey (queue idempotency), rejecting junk keys', async () => {
    vi.mocked(createNote).mockResolvedValue({ id: 'n1' } as never)
    await createNoteAction({ kind: 'set', id: UUID }, 'x', UUID.toUpperCase())
    expect(createNote).toHaveBeenCalledWith(USER, { kind: 'set', id: UUID }, 'x', {
      clientKey: UUID,
    })

    await expect(createNoteAction({ kind: 'set', id: UUID }, 'x', 'my-key')).rejects.toThrow(
      /client key/,
    )
  })

  it('rejects a blank body and a bad anchor before touching the db', async () => {
    await expect(createNoteAction({ kind: 'set', id: UUID }, '   ')).rejects.toThrow(/empty/)
    await expect(createNoteAction({ kind: 'nope', id: UUID }, 'x')).rejects.toThrow(/kind/)
    expect(createNote).not.toHaveBeenCalled()
  })
})

describe('updateNoteAction', () => {
  it('updates an owned note', async () => {
    vi.mocked(updateNote).mockResolvedValue({ id: 'n1' } as never)
    await updateNoteAction(UUID, 'edited')
    expect(updateNote).toHaveBeenCalledWith(USER, UUID, 'edited')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('throws not-found when nothing matched and rejects a malformed id', async () => {
    vi.mocked(updateNote).mockResolvedValue(null)
    await expect(updateNoteAction(UUID, 'x')).rejects.toThrow(/not found/)
    await expect(updateNoteAction('n1', 'x')).rejects.toThrow(/invalid note id/)
  })
})

describe('deleteNoteAction', () => {
  it('deletes and throws not-found when nothing matched', async () => {
    vi.mocked(deleteNote).mockResolvedValue(true)
    await deleteNoteAction(UUID)
    expect(deleteNote).toHaveBeenCalledWith(USER, UUID)

    vi.mocked(deleteNote).mockResolvedValue(false)
    await expect(deleteNoteAction(UUID)).rejects.toThrow(/not found/)
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('listNotesAction', () => {
  it('passes whitelisted filters through', async () => {
    vi.mocked(listNotes).mockResolvedValue([])
    await listNotesAction({ anchorKind: 'set', workoutId: UUID, limit: 50, junk: 'ignored' })
    expect(listNotes).toHaveBeenCalledWith(USER, {
      anchorKind: 'set',
      workoutId: UUID,
      limit: 50,
    })
  })

  it('rejects malformed filter values', async () => {
    await expect(listNotesAction({ anchorKind: 'everything' })).rejects.toThrow(/anchor kind/)
    await expect(listNotesAction({ workoutId: 'w1' })).rejects.toThrow(/workoutId/)
    await expect(listNotesAction({ limit: -1 })).rejects.toThrow(/limit/)
    expect(listNotes).not.toHaveBeenCalled()
  })

  it('works with no filters at all', async () => {
    vi.mocked(listNotes).mockResolvedValue([])
    await listNotesAction()
    expect(listNotes).toHaveBeenCalledWith(USER, {})
  })
})

describe('createSetNotesForWorkoutAction (the post-save positional batch)', () => {
  const ENTRY = {
    exercisePosition: 0,
    setNumber: 3,
    body: '  left shoulder clicked  ',
    clientKey: UUID.toUpperCase(),
  }

  it('validates, normalizes, and creates each entry sequentially — no revalidate', async () => {
    vi.mocked(createPositionalSetNote).mockResolvedValue({ id: 'n1' } as never)

    await createSetNotesForWorkoutAction(UUID.toUpperCase(), [
      ENTRY,
      { ...ENTRY, setNumber: 4, clientKey: '11234567-89ab-cdef-0123-456789abcdef' },
    ])

    expect(createPositionalSetNote).toHaveBeenCalledTimes(2)
    expect(createPositionalSetNote).toHaveBeenNthCalledWith(1, USER, UUID, {
      exercisePosition: 0,
      setNumber: 3,
      body: 'left shoulder clicked',
      clientKey: UUID,
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('throws when the workout is not owned (db returns null)', async () => {
    vi.mocked(createPositionalSetNote).mockResolvedValue(null)
    await expect(createSetNotesForWorkoutAction(UUID, [ENTRY])).rejects.toThrow(/not found/)
  })

  it('rejects malformed entries field-by-field before any db call', async () => {
    await expect(createSetNotesForWorkoutAction('w1', [ENTRY])).rejects.toThrow(/workout id/)
    await expect(createSetNotesForWorkoutAction(UUID, [])).rejects.toThrow(/entries/)
    await expect(createSetNotesForWorkoutAction(UUID, 'notes')).rejects.toThrow(/entries/)
    await expect(
      createSetNotesForWorkoutAction(UUID, [{ ...ENTRY, exercisePosition: -1 }]),
    ).rejects.toThrow(/exercisePosition/)
    await expect(
      createSetNotesForWorkoutAction(UUID, [{ ...ENTRY, setNumber: 0 }]),
    ).rejects.toThrow(/setNumber/)
    await expect(
      createSetNotesForWorkoutAction(UUID, [{ ...ENTRY, clientKey: 'nope' }]),
    ).rejects.toThrow(/clientKey/)
    await expect(createSetNotesForWorkoutAction(UUID, [{ ...ENTRY, body: '   ' }])).rejects.toThrow(
      /body/,
    )
    expect(createPositionalSetNote).not.toHaveBeenCalled()
  })
})

describe('createFallbackSetNoteAction (the queue replay target)', () => {
  it('validates and forwards to the marker-snapshot create', async () => {
    vi.mocked(createWorkoutFallbackNote).mockResolvedValue({ id: 'n1' } as never)

    await createFallbackSetNoteAction(UUID.toUpperCase(), ' downgraded ', UUID.toUpperCase())

    expect(createWorkoutFallbackNote).toHaveBeenCalledWith(USER, UUID, 'downgraded', UUID)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('throws on junk ids/keys and unowned workouts', async () => {
    await expect(createFallbackSetNoteAction('w1', 'x', UUID)).rejects.toThrow(/workout id/)
    await expect(createFallbackSetNoteAction(UUID, 'x', 'k1')).rejects.toThrow(/client key/)
    vi.mocked(createWorkoutFallbackNote).mockResolvedValue(null)
    await expect(createFallbackSetNoteAction(UUID, 'x', UUID)).rejects.toThrow(/not found/)
  })
})
