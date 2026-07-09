import { describe, it, expect, vi } from 'vitest'
import { discardSession } from './discard-session'

function deps() {
  const calls: string[] = []
  return {
    calls,
    settle: vi.fn(async () => {
      calls.push('settle')
    }),
    deleteDraft: vi.fn(async () => {
      calls.push('deleteDraft')
    }),
    deleteWorkout: vi.fn(async () => {
      calls.push('deleteWorkout')
    }),
  }
}

const WORKOUT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

describe('discardSession', () => {
  it('quick-log surface: settles, then deletes only the draft', async () => {
    const d = deps()

    await discardSession('new', d)

    expect(d.calls).toEqual(['settle', 'deleteDraft'])
    expect(d.deleteDraft).toHaveBeenCalledWith('new')
    expect(d.deleteWorkout).not.toHaveBeenCalled()
  })

  it('workout surface: settles, then deletes only the workout (its action clears the draft)', async () => {
    const d = deps()

    await discardSession(WORKOUT_ID, d)

    expect(d.calls).toEqual(['settle', 'deleteWorkout'])
    expect(d.deleteWorkout).toHaveBeenCalledWith(WORKOUT_ID)
    expect(d.deleteDraft).not.toHaveBeenCalled()
  })

  it('works without a settle barrier (surfaces with no autosave queue)', async () => {
    const d = deps()

    await discardSession(WORKOUT_ID, { deleteDraft: d.deleteDraft, deleteWorkout: d.deleteWorkout })

    expect(d.deleteWorkout).toHaveBeenCalledWith(WORKOUT_ID)
  })

  it('a settle failure propagates before anything is deleted', async () => {
    const d = deps()
    d.settle.mockRejectedValueOnce(new Error('offline'))

    await expect(discardSession(WORKOUT_ID, d)).rejects.toThrow('offline')
    expect(d.deleteDraft).not.toHaveBeenCalled()
    expect(d.deleteWorkout).not.toHaveBeenCalled()
  })

  it('a delete failure propagates to the caller', async () => {
    const d = deps()
    d.deleteWorkout.mockRejectedValueOnce(new Error('boom'))

    await expect(discardSession(WORKOUT_ID, d)).rejects.toThrow('boom')
  })
})
