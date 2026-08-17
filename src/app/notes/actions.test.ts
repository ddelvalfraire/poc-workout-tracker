import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createNoteAction,
  updateNoteAction,
  deleteNoteAction,
  listNotesAction,
} from './actions'
import { requireUserId } from '@/lib/auth'
import { createNote, updateNote, deleteNote, listNotes } from '@/db/notes'

/**
 * Action-layer tests for the notes-v2 control flow (the workout/actions.test.ts
 * idiom): the db helpers are the authorization boundary and are unit-tested in
 * db/notes.test.ts; here we mock them and assert validation, the not-found →
 * throw translation, and that NOTHING revalidates (the #214 live-session rule).
 */

vi.mock('@/lib/auth', () => ({ requireUserId: vi.fn() }))
vi.mock('@/db/notes', () => ({
  createNote: vi.fn(),
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
    expect(createNote).toHaveBeenCalledWith(USER, { kind: 'set', id: UUID }, 'shoulder clicked')
    // The live-session rule: a note save must never re-render the logger.
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('throws when the anchor is not owned (db returns null)', async () => {
    vi.mocked(createNote).mockResolvedValue(null)
    await expect(createNoteAction({ kind: 'workout', id: UUID }, 'x')).rejects.toThrow(/not found/)
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
