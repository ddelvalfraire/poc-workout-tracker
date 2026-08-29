import { describe, it, expect } from 'vitest'
import { isLiveSession, declaredSaveKind } from './workout-session-mode'

const RECORDED_AT = new Date('2026-08-27T19:00:00.000Z')
const TOUCHED_AT = new Date('2026-08-27T18:12:00.000Z')

describe('isLiveSession', () => {
  it('is live while no original record has been persisted', () => {
    expect(isLiveSession({ originalRecordedAt: null, completedAt: null })).toBe(true)
  })

  it('is not live once an original record exists', () => {
    expect(isLiveSession({ originalRecordedAt: RECORDED_AT, completedAt: RECORDED_AT })).toBe(false)
  })

  // THE REGRESSION THIS MODULE EXISTS FOR. The MCP patch tools stamp
  // `completedAt` via coalesce(…, now()) on the first set they touch, so a
  // coach patching one set of a session the lifter is still logging leaves
  // exactly this shape. Re-derive the mode from `completedAt` and this fails:
  // the logger's eventual Finish — the session's FIRST persist — would be
  // filed as a correction.
  it('stays live when an agent stamped completedAt mid-session', () => {
    expect(isLiveSession({ originalRecordedAt: null, completedAt: TOUCHED_AT })).toBe(true)
  })

  // The mirror image: un-completing a finished session to fix it clears
  // `completedAt` but does not un-record it. A `completedAt` check would call
  // the repair an original record.
  it('stays a correction after the session was un-completed', () => {
    expect(isLiveSession({ originalRecordedAt: RECORDED_AT, completedAt: null })).toBe(false)
  })
})

describe('declaredSaveKind', () => {
  it("declares a live session's save as that session's original record", () => {
    expect(declaredSaveKind(true)).toBe('original')
  })

  it('declares an edit of a recorded session as an amendment', () => {
    expect(declaredSaveKind(false)).toBe('amendment')
  })

  // End to end over the same two traps, so the kind itself — not just the
  // boolean — is pinned against a completedAt-derived answer.
  it('calls the agent-touched live session an original and the un-completed one an amendment', () => {
    expect(
      declaredSaveKind(isLiveSession({ originalRecordedAt: null, completedAt: TOUCHED_AT })),
    ).toBe('original')
    expect(
      declaredSaveKind(isLiveSession({ originalRecordedAt: RECORDED_AT, completedAt: null })),
    ).toBe('amendment')
  })
})
