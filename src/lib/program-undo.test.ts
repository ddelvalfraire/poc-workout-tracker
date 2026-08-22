import { describe, it, expect } from 'vitest'
import {
  EDIT_GUARDS,
  UNDO_WINDOW_MS,
  anchorBefore,
  guardFor,
  indexForAnchor,
  isTicketFresh,
  isUndoable,
  mintUndoTicket,
  precheckTicket,
  type UndoTicket,
} from './program-undo'

const REVISION = '2026-08-22T14:03:11.482Z'

function ticket(overrides: Partial<UndoTicket> = {}): UndoTicket {
  return {
    programId: 'prog-1',
    action: 'move_program_exercise',
    revision: REVISION,
    subject: 'Lat Pulldown',
    toPosition: 4,
    inverse: {
      kind: 'reorder',
      node: { level: 'exercise', id: 'ex-lat' },
      after: 'ex-row',
    },
    ...overrides,
  }
}

describe('guardFor', () => {
  it('gives the move family a timed undo', () => {
    expect(guardFor('move_program_day')).toBe('undo')
    expect(guardFor('move_program_exercise')).toBe('undo')
    expect(guardFor('move_program_set')).toBe('undo')
  })

  it('keeps a confirm modal on removing a day, whose whole subtree would die with it', () => {
    expect(guardFor('remove_program_day')).toBe('confirm')
  })

  it('leaves program-level policy switches unguarded — their own control is the way back', () => {
    expect(guardFor('set_program_deload_policy')).toBe('none')
    expect(guardFor('set_program_diet_phase')).toBe('none')
    expect(guardFor('set_program_plan_sync')).toBe('none')
    expect(guardFor('adjust_training_max')).toBe('none')
  })

  it('falls safe to confirm for an action nobody has classified', () => {
    // A new mutating op must be classified deliberately; until then it is
    // treated as the expensive kind rather than shipping unguarded.
    expect(guardFor('remove_program_exercise')).toBe('confirm')
    expect(guardFor('obliterate_everything')).toBe('confirm')
  })

  it('never claims an engine-authored write is a user edit', () => {
    // sync_plan_to_performance and the autoregulation writes are the engine's,
    // so there is nothing to take back and no undo may be offered.
    expect(guardFor('sync_plan_to_performance')).not.toBe('undo')
    expect(guardFor('set_program_autoregulation')).toBe('none')
  })

  it('classifies every action in the table as exactly one of the three guards', () => {
    for (const guard of Object.values(EDIT_GUARDS)) {
      expect(['undo', 'confirm', 'none']).toContain(guard)
    }
  })
})

describe('isUndoable', () => {
  it('is true only for the guards marked undo', () => {
    expect(isUndoable('move_program_set')).toBe(true)
    expect(isUndoable('remove_program_day')).toBe(false)
    expect(isUndoable('adjust_training_max')).toBe(false)
    expect(isUndoable('nonsense')).toBe(false)
  })
})

describe('anchorBefore', () => {
  it('names the sibling the node followed', () => {
    expect(anchorBefore(['a', 'b', 'c'], 'c')).toBe('b')
  })

  it('returns null when the node was first, meaning "restore to the front"', () => {
    expect(anchorBefore(['a', 'b', 'c'], 'a')).toBeNull()
  })

  it('throws when the node is not among the siblings it was handed', () => {
    // Inventing null here would silently mean "restore to first" — a wrong
    // answer dressed as a valid one.
    expect(() => anchorBefore(['a', 'b'], 'z')).toThrow(/not among its siblings/)
  })
})

describe('indexForAnchor', () => {
  it('splices just after the anchor', () => {
    // 'c' was anchored after 'b'; with 'c' pulled out the list is [a, b, d].
    expect(indexForAnchor(['a', 'b', 'd'], 'b')).toBe(2)
  })

  it('splices at the front for a null anchor', () => {
    expect(indexForAnchor(['b', 'c'], null)).toBe(0)
  })

  it('refuses rather than appending when the anchor has vanished', () => {
    // The predecessor was deleted since. Appending would be a plausible-looking
    // wrong answer, so the anchor resolves to null and the caller must refuse.
    expect(indexForAnchor(['a', 'b'], 'gone')).toBeNull()
  })

  it('round-trips a move back to the original order', () => {
    // The mock's case: Lat Pulldown sat 2nd, was moved to 4th, and Undo must
    // put it back 2nd — expressed entirely without positions.
    const before = ['row', 'lat', 'curl', 'fly']
    const anchor = anchorBefore(before, 'lat')

    const afterMove = ['row', 'curl', 'fly', 'lat']
    const withoutMoved = afterMove.filter((id) => id !== 'lat')
    const target = indexForAnchor(withoutMoved, anchor)

    expect(target).not.toBeNull()
    const restored = [...withoutMoved]
    restored.splice(target as number, 0, 'lat')
    expect(restored).toEqual(before)
  })

  it('round-trips a move away from the front', () => {
    const before = ['lat', 'row', 'curl']
    const anchor = anchorBefore(before, 'lat')
    expect(anchor).toBeNull()

    const withoutMoved = ['row', 'curl']
    const restored = [...withoutMoved]
    restored.splice(indexForAnchor(withoutMoved, anchor) as number, 0, 'lat')
    expect(restored).toEqual(before)
  })
})

describe('isTicketFresh', () => {
  it('is fresh while the program has not been written since', () => {
    expect(isTicketFresh(ticket(), REVISION)).toBe(true)
  })

  it('goes stale on any interleaving write, including one elsewhere in the program', () => {
    // The coach agent, a second tab, another device — the gate does not care
    // which, and that coarseness is the point.
    expect(isTicketFresh(ticket(), '2026-08-22T14:03:12.000Z')).toBe(false)
  })

  it('compares instants, not strings, so ISO spelling does not matter', () => {
    expect(isTicketFresh(ticket({ revision: '2026-08-22T14:03:11.482+00:00' }), REVISION)).toBe(
      true,
    )
  })

  it('is not fresh when either side is unparseable', () => {
    expect(isTicketFresh(ticket(), 'not-a-date')).toBe(false)
    expect(isTicketFresh(ticket({ revision: '' }), REVISION)).toBe(false)
  })
})

describe('mintUndoTicket', () => {
  const inverse = {
    kind: 'reorder',
    node: { level: 'exercise', id: 'ex-lat' },
    after: 'ex-row',
  } as const

  it('mints a ticket for an undoable action', () => {
    const minted = mintUndoTicket({
      programId: 'prog-1',
      action: 'move_program_exercise',
      revision: REVISION,
      subject: 'Lat Pulldown',
      toPosition: 4,
      inverse,
    })
    expect(minted).toEqual({
      programId: 'prog-1',
      action: 'move_program_exercise',
      revision: REVISION,
      subject: 'Lat Pulldown',
      toPosition: 4,
      inverse,
    })
  })

  it('refuses to mint for an action the guard table does not mark undo', () => {
    // The one place that stops a caller promising undo for a subtree removal.
    for (const action of ['remove_program_day', 'adjust_training_max', 'set_program_plan_sync']) {
      expect(
        mintUndoTicket({
          programId: 'prog-1',
          action,
          revision: REVISION,
          subject: 'x',
          toPosition: 1,
          inverse,
        }),
      ).toBeNull()
    }
  })

  it('refuses to mint for an unclassified action', () => {
    expect(
      mintUndoTicket({
        programId: 'prog-1',
        action: 'remove_program_set',
        revision: REVISION,
        subject: 'x',
        toPosition: 1,
        inverse,
      }),
    ).toBeNull()
  })
})

describe('precheckTicket', () => {
  it('passes a fresh ticket through for the real attempt', () => {
    expect(precheckTicket(ticket(), REVISION)).toBeNull()
  })

  it('refuses a ticket whose program moved on', () => {
    expect(precheckTicket(ticket(), '2026-08-22T14:09:00.000Z')).toBe('stale')
  })

  it('refuses a ticket whose action is no longer undoable', () => {
    // Re-checked at apply time so a ticket minted before a policy change, or
    // forged by a client, cannot slip past the guard table.
    const forged = ticket({
      action: 'remove_program_day' as UndoTicket['action'],
    })
    expect(precheckTicket(forged, REVISION)).toBe('not-found')
  })
})

describe('UNDO_WINDOW_MS', () => {
  it('matches the logger undo window so the two reversals feel like one idea', () => {
    expect(UNDO_WINDOW_MS).toBe(8_000)
  })
})
