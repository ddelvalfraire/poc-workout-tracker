import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTableName, type Table } from 'drizzle-orm'

/**
 * Chain-recording stub in the adopt-program.test.ts idiom: `db.transaction`
 * runs its callback on a tx whose select/insert/update/delete chains record
 * into `records` (tagged with the REAL table name via getTableName) and read
 * from `selectQueue` in call order. The program-patches module is mocked so
 * confirm's per-patch application is observable as plain calls — the ops'
 * own behavior is covered by program-patches.test.ts.
 */
const records: { op: string; values?: unknown }[] = []
let selectQueue: unknown[][] = []

type Resolve = (value: unknown) => unknown

function selectChain() {
  const rows = selectQueue.shift() ?? []
  const obj = {
    from: () => obj,
    innerJoin: () => obj,
    where: () => obj,
    limit: () => obj,
    orderBy: () => obj,
    then: (resolve: Resolve) => Promise.resolve(rows).then(resolve),
  }
  return obj
}

function makeTx() {
  return {
    select: () => selectChain(),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        records.push({ op: `insert:${getTableName(table as Table)}`, values })
        return {
          returning: () => ({
            then: (resolve: Resolve) => Promise.resolve([{ id: 'pp1' }]).then(resolve),
          }),
          then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve),
        }
      },
    }),
    update: (table: unknown) => {
      const name = getTableName(table as Table)
      const obj = {
        set: (values: unknown) => {
          records.push({ op: `update:${name}`, values })
          return obj
        },
        where: () => obj,
        then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve),
      }
      return obj
    },
    delete: (table: unknown) => {
      records.push({ op: `delete:${getTableName(table as Table)}` })
      const obj = {
        where: () => obj,
        then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve),
      }
      return obj
    },
  }
}

vi.mock('./index', () => ({
  db: {
    transaction: (cb: (tx: ReturnType<typeof makeTx>) => unknown) => cb(makeTx()),
    select: () => selectChain(),
  },
}))

const {
  addProgramSetMock,
  updateProgramSetMock,
  removeProgramSetMock,
  setOverrideMock,
  removeOverrideMock,
  setTrainingMaxMock,
} = vi.hoisted(() => ({
  addProgramSetMock: vi.fn(),
  updateProgramSetMock: vi.fn(),
  removeProgramSetMock: vi.fn(),
  setOverrideMock: vi.fn(),
  removeOverrideMock: vi.fn(),
  setTrainingMaxMock: vi.fn(),
}))

vi.mock('./program-patches', () => ({
  addProgramSet: addProgramSetMock,
  updateProgramSet: updateProgramSetMock,
  removeProgramSet: removeProgramSetMock,
  setProgramSetOverride: setOverrideMock,
  removeProgramSetOverride: removeOverrideMock,
  setTrainingMax: setTrainingMaxMock,
  withTx: (tx: unknown) => ({ transaction: (cb: (t: unknown) => unknown) => cb(tx) }),
}))

import {
  createPatchProposal,
  listPatchProposals,
  confirmPatchProposal,
  declinePatchProposal,
} from './patch-proposals'
import { PatchProposalError } from './program-errors'

const USER = 'user_123'
const PID = '22222222-2222-4222-8222-222222222222'
const PROPOSAL_ID = '33333333-3333-4333-8333-333333333333'

const TM_PATCH = {
  tool: 'set_training_max',
  args: { dayPosition: 0, exercisePosition: 1, trainingMax: 90 },
}
const ADD_SET_PATCH = {
  tool: 'add_program_set',
  args: { dayPosition: 1, exercisePosition: 0, repMin: 8, repMax: 12, suggestedLoad: 100, unit: 'kg' },
}

const eventInsert = () =>
  records.find((r) => r.op === 'insert:program_events')?.values as Record<string, unknown>

beforeEach(() => {
  records.length = 0
  selectQueue = []
  vi.clearAllMocks()
  addProgramSetMock.mockResolvedValue({ setNumber: 4 })
  updateProgramSetMock.mockResolvedValue({ id: 'ps1' })
  removeProgramSetMock.mockResolvedValue({ removed: true })
  setOverrideMock.mockResolvedValue({ week: 4, cleared: false })
  removeOverrideMock.mockResolvedValue({ removed: true })
  setTrainingMaxMock.mockResolvedValue({ id: 'pe1', trainingMaxKg: 90 })
})

describe('createPatchProposal', () => {
  it('stores ONE pending row with the validated patch array and logs the ask', async () => {
    // Arrange — owned, active program
    selectQueue = [[{ id: PID, status: 'active' }]]

    // Act
    const result = await createPatchProposal(
      USER,
      PID,
      { summary: 'Add a chest set', patches: [ADD_SET_PATCH, TM_PATCH] },
      'coach',
    )

    // Assert — one proposal row (no patch-list table), patches verbatim
    expect(result).toEqual({ id: 'pp1' })
    expect(records[0]).toMatchObject({
      op: 'insert:program_patch_proposals',
      values: {
        programId: PID,
        userId: USER,
        authorActor: 'coach',
        summary: 'Add a chest set',
        patches: [ADD_SET_PATCH, TM_PATCH],
      },
    })
    expect(eventInsert()).toMatchObject({
      programId: PID,
      userId: USER,
      actor: 'coach',
      action: 'propose_program_patches',
      summary: 'Proposed 2 changes: Add a chest set',
      payload: { proposalId: 'pp1', patchCount: 2 },
    })
  })

  it('returns null (no writes) when the program is not owned', async () => {
    selectQueue = [[]]
    const result = await createPatchProposal(
      USER,
      PID,
      { summary: 'x', patches: [TM_PATCH] },
      'mcp',
    )
    expect(result).toBeNull()
    expect(records).toHaveLength(0)
  })

  it('refuses a non-active program — proposals target the live plan', async () => {
    selectQueue = [[{ id: PID, status: 'archived' }]]
    await expect(
      createPatchProposal(USER, PID, { summary: 'x', patches: [TM_PATCH] }, 'coach'),
    ).rejects.toThrow(/active program.*archived/)
    expect(records).toHaveLength(0)
  })

  it('rejects invalid patches BEFORE any read (validated at propose time)', async () => {
    await expect(
      createPatchProposal(
        USER,
        PID,
        { summary: 'x', patches: [{ tool: 'delete_program', args: {} }] },
        'coach',
      ),
    ).rejects.toThrow(PatchProposalError)
    expect(selectQueue).toHaveLength(0) // queue untouched — no read happened
    expect(records).toHaveLength(0)
  })

  it('rejects a blank summary', async () => {
    await expect(
      createPatchProposal(USER, PID, { summary: '   ', patches: [TM_PATCH] }, 'coach'),
    ).rejects.toThrow(/summary/)
    expect(records).toHaveLength(0)
  })
})

describe('confirmPatchProposal (single combined confirm)', () => {
  const pendingRow = (over: Record<string, unknown> = {}) => [
    {
      id: PROPOSAL_ID,
      programId: PID,
      authorActor: 'coach',
      patches: [ADD_SET_PATCH, TM_PATCH],
      programStatus: 'active',
      ...over,
    },
  ]

  it('applies every patch through the existing ops with the PROPOSAL actor, then marks applied', async () => {
    // Arrange
    selectQueue = [pendingRow()]

    // Act
    const result = await confirmPatchProposal(USER, PROPOSAL_ID)

    // Assert — both ops called, actor is the proposal's author (not 'ui')
    expect(result).toEqual({ id: PROPOSAL_ID, programId: PID, applied: 2 })
    expect(addProgramSetMock).toHaveBeenCalledExactlyOnceWith(
      USER,
      PID,
      1,
      0,
      { repMin: 8, repMax: 12, suggestedLoadKg: 100 },
      'coach',
      expect.objectContaining({ transaction: expect.any(Function) }),
    )
    expect(setTrainingMaxMock).toHaveBeenCalledExactlyOnceWith(
      USER,
      PID,
      0,
      1,
      90,
      'manual',
      'coach',
      expect.objectContaining({ runIn: expect.anything() }),
    )
    // The row flips to 'applied' (kept as the audit anchor) and the owner's
    // decision gets its own event.
    expect(records.some((r) => r.op === 'update:program_patch_proposals')).toBe(true)
    expect(eventInsert()).toMatchObject({
      actor: 'ui',
      action: 'confirm_patch_proposal',
      summary: 'Applied 2 proposed changes',
      payload: { proposalId: PROPOSAL_ID, patchCount: 2 },
    })
  })

  it('applies NOTHING when any patch no longer matches (null result rolls back the lot)', async () => {
    // Arrange — second patch's address is gone
    selectQueue = [pendingRow()]
    setTrainingMaxMock.mockResolvedValue(null)

    // Act + Assert
    await expect(confirmPatchProposal(USER, PROPOSAL_ID)).rejects.toThrow(
      /change 2 of 2 no longer matches.*nothing was applied/,
    )
    // The throw aborts the transaction: no status flip, no confirm event.
    expect(records.some((r) => r.op === 'update:program_patch_proposals')).toBe(false)
    expect(records.some((r) => r.op === 'insert:program_events')).toBe(false)
  })

  it('refuses when the program is no longer active', async () => {
    selectQueue = [pendingRow({ programStatus: 'archived' })]
    await expect(confirmPatchProposal(USER, PROPOSAL_ID)).rejects.toThrow(/no longer active/)
    expect(addProgramSetMock).not.toHaveBeenCalled()
  })

  it('re-validates stored patches at confirm time (corrupt jsonb applies nothing)', async () => {
    selectQueue = [pendingRow({ patches: [{ tool: 'set_training_max', args: { trainingMax: -5 } }] })]
    await expect(confirmPatchProposal(USER, PROPOSAL_ID)).rejects.toThrow(PatchProposalError)
    expect(setTrainingMaxMock).not.toHaveBeenCalled()
  })

  it('returns null when the proposal is not owned or not pending', async () => {
    selectQueue = [[]]
    expect(await confirmPatchProposal(USER, PROPOSAL_ID)).toBeNull()
    expect(records).toHaveLength(0)
  })
})

describe('declinePatchProposal', () => {
  it('logs the decline then hard-deletes the row (decline discards)', async () => {
    // Arrange
    selectQueue = [[{ id: PROPOSAL_ID, programId: PID }]]

    // Act
    const result = await declinePatchProposal(USER, PROPOSAL_ID)

    // Assert — event BEFORE delete, both inside the transaction
    expect(result).toEqual({ id: PROPOSAL_ID, programId: PID })
    expect(records.map((r) => r.op)).toEqual([
      'insert:program_events',
      'delete:program_patch_proposals',
    ])
    expect(eventInsert()).toMatchObject({
      actor: 'ui',
      action: 'decline_patch_proposal',
      summary: 'Proposed changes declined',
    })
  })

  it('returns null (no writes) when not owned or not pending', async () => {
    selectQueue = [[]]
    expect(await declinePatchProposal(USER, PROPOSAL_ID)).toBeNull()
    expect(records).toHaveLength(0)
  })
})

describe('listPatchProposals', () => {
  it('returns pending rows with parsed patches and drops corrupt ones', async () => {
    // Arrange — one valid, one corrupt (silence over corruption)
    selectQueue = [
      [
        {
          id: 'pp1',
          programId: PID,
          authorActor: 'coach',
          summary: 'Add a chest set',
          patches: [TM_PATCH],
          createdAt: new Date('2026-08-01T00:00:00Z'),
        },
        {
          id: 'pp2',
          programId: PID,
          authorActor: 'coach',
          summary: 'Corrupt',
          patches: [{ tool: 'nope' }],
          createdAt: new Date('2026-08-02T00:00:00Z'),
        },
      ],
    ]

    // Act
    const rows = await listPatchProposals(USER, PID)

    // Assert
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'pp1', summary: 'Add a chest set', patches: [TM_PATCH] })
  })
})
