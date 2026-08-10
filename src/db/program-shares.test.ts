import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Recording stub for the share layer (mirrors save-program.test.ts). Selects
 * resolve from a per-call queue; inserts/updates record their table + values
 * and resolve queued ids. `db.transaction(cb)` runs `cb` against the same
 * recorder, so event rows written inside a tx are assertable too.
 * `getProgramDetail`/`copyProgramTree` are mocked — the tree-copy fidelity is
 * clone-program.test.ts's job; here we assert the GATES and the row facts.
 */

const selectQueue: unknown[][] = []
const inserts: { table: unknown; values: unknown }[] = []
const updates: { table: unknown; values: unknown }[] = []
let insertReturningQueue: unknown[][] = []
let updateReturningQueue: unknown[][] = []

type Resolve = (value: unknown) => unknown

interface FluentSelect {
  from: () => FluentSelect
  innerJoin: () => FluentSelect
  where: () => FluentSelect
  orderBy: () => FluentSelect
  limit: () => FluentSelect
  then: (resolve: Resolve) => Promise<unknown>
}

function makeSelect(rows: unknown[]): FluentSelect {
  const builder: FluentSelect = {
    from: () => builder,
    innerJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => builder,
    then: (resolve: Resolve) => Promise.resolve(rows).then(resolve),
  }
  return builder
}

function makeDb() {
  const handle = {
    select: () => makeSelect(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table, values: v })
        return {
          returning: () => Promise.resolve(insertReturningQueue.shift() ?? []),
          // Event inserts are awaited without .returning().
          then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve),
        }
      },
    }),
    update: (table: unknown) => ({
      set: (v: unknown) => {
        updates.push({ table, values: v })
        return {
          where: () => ({
            returning: () => Promise.resolve(updateReturningQueue.shift() ?? []),
            // setProgramVisibility awaits the update without .returning().
            then: (resolve: Resolve) => Promise.resolve(undefined).then(resolve),
          }),
        }
      },
    }),
    transaction: (cb: (tx: unknown) => unknown) => Promise.resolve(cb(handle)),
  }
  return handle
}

vi.mock('./index', () => ({ db: makeDb() }))

const { getProgramDetail, copyProgramTree } = vi.hoisted(() => ({
  getProgramDetail: vi.fn(),
  copyProgramTree: vi.fn(),
}))
vi.mock('./programs', () => ({ getProgramDetail, copyProgramTree }))

import {
  mintShareToken,
  setProgramVisibility,
  createShare,
  revokeShare,
  getActiveShare,
  resolveShare,
  adoptShared,
} from './program-shares'
import {
  NotSharableProgramError,
  OwnSharedProgramError,
  ProposedProgramError,
} from './program-errors'
import { programs, programShares, programEvents } from './schema'

const OWNER = 'user_owner'
const VISITOR = 'user_visitor'
const PROGRAM_ID = 'prog-1'
const TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz012345'

/** The 32-char base64url alphabet shape every minted token must have. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32}$/

/** An owned-program authz slice as readOwnedProgram selects it. */
function ownedRow(over: Record<string, unknown> = {}) {
  return { userId: OWNER, visibility: 'link', status: 'active', ...over }
}

/** A share row joined to its program, as readShareByToken selects it. */
function shareRow(over: Record<string, unknown> = {}) {
  return {
    programId: PROGRAM_ID,
    revokedAt: null,
    ownerUserId: OWNER,
    visibility: 'link',
    status: 'active',
    ...over,
  }
}

/** A minimal ProgramDetail-shaped source for adoptShared. */
function sourceDetail(over: Record<string, unknown> = {}) {
  return {
    id: PROGRAM_ID,
    userId: OWNER,
    name: 'PPL',
    status: 'active',
    authorActor: 'owner',
    mesocycleWeeks: 4,
    deloadWeek: 4,
    autoregulation: true,
    planSync: false,
    checkInEveryDays: 14,
    visibility: 'link',
    notes: 'shared notes',
    description: 'A block',
    icon: '🏋️',
    heroImageUrl: null,
    sourceUrl: 'https://example.com/src',
    createdAt: new Date(),
    updatedAt: new Date(),
    days: [],
    ...over,
  }
}

beforeEach(() => {
  selectQueue.length = 0
  inserts.length = 0
  updates.length = 0
  insertReturningQueue = []
  updateReturningQueue = []
  getProgramDetail.mockReset()
  copyProgramTree.mockReset()
})

describe('mintShareToken', () => {
  it('mints 32 base64url chars (192-bit entropy) and never repeats', () => {
    // Act
    const a = mintShareToken()
    const b = mintShareToken()

    // Assert
    expect(a).toMatch(TOKEN_SHAPE)
    expect(b).toMatch(TOKEN_SHAPE)
    expect(a).not.toBe(b)
  })
})

describe('setProgramVisibility', () => {
  it('returns null for a program the user does not own', async () => {
    // Arrange — the ownership-scoped read matches nothing
    selectQueue.push([])

    // Act / Assert
    expect(await setProgramVisibility(VISITOR, PROGRAM_ID, 'link')).toBeNull()
    expect(updates).toHaveLength(0)
  })

  it('refuses a proposed program with ProposedProgramError', async () => {
    // Arrange
    selectQueue.push([ownedRow({ status: 'proposed' })])

    // Act / Assert — can() denies manage on proposals
    await expect(setProgramVisibility(OWNER, PROGRAM_ID, 'link')).rejects.toBeInstanceOf(
      ProposedProgramError,
    )
    expect(updates).toHaveLength(0)
  })

  it('writes the flip and logs a set_program_visibility event', async () => {
    // Arrange
    selectQueue.push([ownedRow({ visibility: 'private' })])

    // Act
    const result = await setProgramVisibility(OWNER, PROGRAM_ID, 'public')

    // Assert — update on programs + one event row in the same transaction
    expect(result).toEqual({ id: PROGRAM_ID })
    expect(updates).toHaveLength(1)
    expect(updates[0].table).toBe(programs)
    expect(updates[0].values).toMatchObject({ visibility: 'public' })
    expect(inserts).toHaveLength(1)
    expect(inserts[0].table).toBe(programEvents)
    expect(inserts[0].values).toMatchObject({
      programId: PROGRAM_ID,
      userId: OWNER,
      actor: 'ui',
      action: 'set_program_visibility',
      payload: { before: { visibility: 'private' }, after: { visibility: 'public' } },
    })
  })

  it('is a silent no-op when the value is unchanged (no update, no event)', async () => {
    // Arrange
    selectQueue.push([ownedRow({ visibility: 'link' })])

    // Act
    const result = await setProgramVisibility(OWNER, PROGRAM_ID, 'link')

    // Assert
    expect(result).toEqual({ id: PROGRAM_ID })
    expect(updates).toHaveLength(0)
    expect(inserts).toHaveLength(0)
  })
})

describe('createShare', () => {
  it('refuses a private program with NotSharableProgramError', async () => {
    // Arrange
    selectQueue.push([ownedRow({ visibility: 'private' })])

    // Act / Assert
    await expect(createShare(OWNER, PROGRAM_ID)).rejects.toBeInstanceOf(NotSharableProgramError)
    expect(inserts).toHaveLength(0)
  })

  it('refuses a proposed program with ProposedProgramError', async () => {
    // Arrange
    selectQueue.push([ownedRow({ status: 'proposed' })])

    // Act / Assert
    await expect(createShare(OWNER, PROGRAM_ID)).rejects.toBeInstanceOf(ProposedProgramError)
  })

  it('returns null when the program is not owned', async () => {
    // Arrange
    selectQueue.push([])

    // Act / Assert
    expect(await createShare(VISITOR, PROGRAM_ID)).toBeNull()
  })

  it('is idempotent: an existing live share is returned, no new token minted', async () => {
    // Arrange — owned + a live share already exists
    selectQueue.push([ownedRow()], [{ id: 'share-1', token: TOKEN }])

    // Act
    const result = await createShare(OWNER, PROGRAM_ID)

    // Assert
    expect(result).toEqual({ id: 'share-1', token: TOKEN })
    expect(inserts).toHaveLength(0)
  })

  it('mints a well-shaped token when no live share exists', async () => {
    // Arrange — owned, no live share; the insert echoes what it received
    selectQueue.push([ownedRow()], [])
    insertReturningQueue.push([{ id: 'share-2', token: 'echoed-by-db' }])

    // Act
    const result = await createShare(OWNER, PROGRAM_ID)

    // Assert — one insert into program_shares with a 32-char base64url token
    expect(result).toEqual({ id: 'share-2', token: 'echoed-by-db' })
    expect(inserts).toHaveLength(1)
    expect(inserts[0].table).toBe(programShares)
    const values = inserts[0].values as { programId: string; token: string }
    expect(values.programId).toBe(PROGRAM_ID)
    expect(values.token).toMatch(TOKEN_SHAPE)
  })
})

describe('revokeShare', () => {
  it('returns null when not owned and revokes nothing', async () => {
    // Arrange
    selectQueue.push([])

    // Act / Assert
    expect(await revokeShare(VISITOR, PROGRAM_ID)).toBeNull()
    expect(updates).toHaveLength(0)
  })

  it('stamps revokedAt on live shares and reports the count', async () => {
    // Arrange
    selectQueue.push([ownedRow()])
    updateReturningQueue.push([{ id: 'share-1' }, { id: 'share-2' }])

    // Act
    const result = await revokeShare(OWNER, PROGRAM_ID)

    // Assert
    expect(result).toEqual({ revoked: 2 })
    expect(updates).toHaveLength(1)
    expect(updates[0].table).toBe(programShares)
    expect((updates[0].values as { revokedAt: Date }).revokedAt).toBeInstanceOf(Date)
  })
})

describe('getActiveShare', () => {
  it('returns the live token for the owner and null when none', async () => {
    // Arrange / Act / Assert
    selectQueue.push([{ token: TOKEN }])
    expect(await getActiveShare(OWNER, PROGRAM_ID)).toEqual({ token: TOKEN })

    selectQueue.push([])
    expect(await getActiveShare(OWNER, PROGRAM_ID)).toBeNull()
  })
})

describe('resolveShare (the public read)', () => {
  it('returns null for an unknown token', async () => {
    // Arrange
    selectQueue.push([])

    // Act / Assert
    expect(await resolveShare('tok_unknown')).toBeNull()
    expect(getProgramDetail).not.toHaveBeenCalled()
  })

  it.each([
    ['revoked share', shareRow({ revokedAt: new Date() })],
    ['private program', shareRow({ visibility: 'private' })],
    ['proposed program', shareRow({ status: 'proposed' })],
  ])('returns the same constant-shape null for a %s', async (_label, row) => {
    // Arrange
    selectQueue.push([row])

    // Act / Assert — no distinguishing signal, and no content read happens
    expect(await resolveShare(TOKEN)).toBeNull()
    expect(getProgramDetail).not.toHaveBeenCalled()
  })

  it('returns CONTENT ONLY for a live share: the detail read plus ownerUserId', async () => {
    // Arrange
    selectQueue.push([shareRow()])
    const detail = sourceDetail()
    getProgramDetail.mockResolvedValue(detail)

    // Act
    const result = await resolveShare(TOKEN)

    // Assert — the read is getProgramDetail under the OWNER's id, and the
    // result exposes exactly {ownerUserId, program}: no history/stats/events
    // can ride along because nothing else is fetched or returned.
    expect(getProgramDetail).toHaveBeenCalledWith(OWNER, PROGRAM_ID)
    expect(result).not.toBeNull()
    expect(Object.keys(result!).sort()).toEqual(['ownerUserId', 'program'])
    expect(result!.ownerUserId).toBe(OWNER)
    expect(result!.program).toBe(detail)
  })
})

describe('adoptShared (cross-account clone)', () => {
  it('refuses adopting your own program with OwnSharedProgramError', async () => {
    // Arrange
    selectQueue.push([shareRow()])

    // Act / Assert
    await expect(adoptShared(OWNER, TOKEN)).rejects.toBeInstanceOf(OwnSharedProgramError)
    expect(inserts).toHaveLength(0)
  })

  it.each([
    ['unknown token', []],
    ['revoked share', [shareRow({ revokedAt: new Date() })]],
    ['private program', [shareRow({ visibility: 'private' })]],
    ['proposed program', [shareRow({ status: 'proposed' })]],
  ])('re-validates at clone time: %s adopts nothing', async (_label, rows) => {
    // Arrange
    selectQueue.push(rows)

    // Act / Assert — constant-shape null, and nothing is cloned
    expect(await adoptShared(VISITOR, TOKEN)).toBeNull()
    expect(inserts).toHaveLength(0)
    expect(copyProgramTree).not.toHaveBeenCalled()
  })

  it('clones into the visitor account as a private proposal attributed to the sharer', async () => {
    // Arrange
    selectQueue.push([shareRow()])
    const detail = sourceDetail()
    getProgramDetail.mockResolvedValue(detail)
    insertReturningQueue.push([{ id: 'clone-1' }])

    // Act
    const result = await adoptShared(VISITOR, TOKEN)

    // Assert — program row: visitor-owned, proposed, authorActor = sharer,
    // and NO visibility key (the column default 'private' is the reset).
    expect(result).toEqual({ id: 'clone-1' })
    expect(inserts[0].table).toBe(programs)
    const values = inserts[0].values as Record<string, unknown>
    expect(values).toMatchObject({
      userId: VISITOR,
      name: 'PPL',
      status: 'proposed',
      authorActor: OWNER,
      planSync: false,
      checkInEveryDays: 14,
      sourceUrl: 'https://example.com/src',
    })
    expect('visibility' in values).toBe(false)
    // The sharer's diet phase never travels — it is about THEIR body.
    expect('dietPhase' in values).toBe(false)
    expect('dietPhaseSetAt' in values).toBe(false)

    // The tree copies with clone fidelity, on the same handle/program.
    expect(copyProgramTree).toHaveBeenCalledTimes(1)
    expect(copyProgramTree.mock.calls[0][1]).toBe(detail.days)
    expect(copyProgramTree.mock.calls[0][2]).toBe('clone-1')

    // The adoption event lands on the CLONE, attributed in the payload.
    const event = inserts.find((i) => i.table === programEvents)
    expect(event).toBeDefined()
    expect(event!.values).toMatchObject({
      programId: 'clone-1',
      userId: VISITOR,
      actor: 'ui',
      action: 'adopt_shared_program',
      payload: { sourceProgramId: PROGRAM_ID, sharedBy: OWNER },
    })
  })
})
