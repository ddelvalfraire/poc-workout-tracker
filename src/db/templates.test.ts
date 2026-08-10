import { describe, it, expect, vi, beforeEach } from 'vitest'
import { type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

/**
 * Recording stub for the template-library layer (the program-shares.test.ts
 * idiom): selects resolve from a per-call queue and capture where-conditions
 * for PgDialect param introspection; inserts record their table + values and
 * resolve queued ids. `db.transaction(cb)` runs `cb` against the same
 * recorder, so the adopt event row is assertable. `getProgramDetail`/
 * `copyProgramTree` are mocked — tree-copy fidelity is clone-program.test.ts's
 * job; here we assert the GATES and the row facts.
 */

const selectQueue: unknown[][] = []
const whereArgs: unknown[] = []
const inserts: { table: unknown; values: unknown }[] = []
let insertReturningQueue: unknown[][] = []

type Resolve = (value: unknown) => unknown

function makeSelect(rows: unknown[]) {
  const builder = {
    from: () => builder,
    where: (cond: unknown) => {
      whereArgs.push(cond)
      return builder
    },
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

import { adoptTemplate, getTemplate } from './templates'
import { TEMPLATE_OWNER_USER_ID } from '@/lib/template-owner'
import { programs, programEvents } from './schema'

const VISITOR = 'user_visitor'
const TEMPLATE_ID = 'tmpl-1'

/** The template's authz slice as adoptTemplate's gate read selects it. */
function templateRow(over: Record<string, unknown> = {}) {
  return { userId: TEMPLATE_OWNER_USER_ID, visibility: 'public', status: 'draft', ...over }
}

/** A minimal ProgramDetail-shaped source for the copy. */
function sourceDetail(over: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    name: 'StrongLifts 5×5',
    mesocycleWeeks: 12,
    deloadWeek: null,
    autoregulation: true,
    autoregStallPolicy: 'all-sets',
    deloadPolicy: null,
    planSync: true,
    checkInEveryDays: null,
    notes: null,
    description: 'Two alternating full-body workouts.',
    icon: '🏋️',
    heroImageUrl: null,
    sourceUrl: 'https://stronglifts.com/stronglifts-5x5/',
    days: [{ position: 0 }],
    ...over,
  }
}

function whereParams(index: number): unknown[] {
  return new PgDialect().sqlToQuery(whereArgs[index] as SQL).params
}

beforeEach(() => {
  selectQueue.length = 0
  whereArgs.length = 0
  inserts.length = 0
  insertReturningQueue = []
  getProgramDetail.mockReset()
  copyProgramTree.mockReset()
})

describe('adoptTemplate (the library pull — copy, never link)', () => {
  it('copies a public system template into the account as a DRAFT, event-logged', async () => {
    // Arrange
    selectQueue.push([templateRow()])
    getProgramDetail.mockResolvedValue(sourceDetail())
    insertReturningQueue = [[{ id: 'copy-1' }]]

    // Act
    const result = await adoptTemplate(VISITOR, TEMPLATE_ID)

    // Assert — the copy is the visitor's own DRAFT (no forced confirm: the
    // user asked for it, same rationale as the wger import), attributed to
    // the system owner, visibility reset to the column default.
    expect(result).toEqual({ id: 'copy-1' })
    expect(inserts[0].table).toBe(programs)
    expect(inserts[0].values).toMatchObject({
      userId: VISITOR,
      name: 'StrongLifts 5×5',
      status: 'draft',
      authorActor: TEMPLATE_OWNER_USER_ID,
      description: 'Two alternating full-body workouts.',
      icon: '🏋️',
      sourceUrl: 'https://stronglifts.com/stronglifts-5x5/',
    })
    expect(inserts[0].values).not.toHaveProperty('visibility')
    // The diet phase never travels: a template can't know the adopter's diet.
    expect(inserts[0].values).not.toHaveProperty('dietPhase')
    expect(inserts[0].values).not.toHaveProperty('dietPhaseSetAt')
    // The tree is copied from the SOURCE detail into the new row.
    expect(copyProgramTree).toHaveBeenCalledWith(expect.anything(), sourceDetail().days, 'copy-1')
    // The clone's timeline opens with where it came from.
    expect(inserts[1].table).toBe(programEvents)
    expect(inserts[1].values).toMatchObject({
      programId: 'copy-1',
      userId: VISITOR,
      actor: 'ui',
      action: 'adopt_template',
      payload: { sourceProgramId: TEMPLATE_ID },
    })
    // The gate read is scoped to the SYSTEM owner — a user's row with the
    // same id can never be selected.
    expect(whereParams(0)).toContain(TEMPLATE_OWNER_USER_ID)
    expect(whereParams(0)).toContain(TEMPLATE_ID)
  })

  it('the source is read under the SYSTEM owner id (the one cross-account read)', async () => {
    selectQueue.push([templateRow()])
    getProgramDetail.mockResolvedValue(sourceDetail())
    insertReturningQueue = [[{ id: 'copy-1' }]]

    await adoptTemplate(VISITOR, TEMPLATE_ID)

    expect(getProgramDetail).toHaveBeenCalledWith(TEMPLATE_OWNER_USER_ID, TEMPLATE_ID)
  })

  it.each([
    ['a private system row', templateRow({ visibility: 'private' })],
    ['a link-only system row', templateRow({ visibility: 'link' })],
    ['a proposed system row', templateRow({ status: 'proposed' })],
    // Defense-in-depth: even if the owner-scoped SQL ever returned a foreign
    // row, the can() decision still refuses it.
    ['a non-system owner', templateRow({ userId: 'user_other' })],
  ])('refuses %s with the constant-shape null, writing nothing', async (_label, row) => {
    selectQueue.push([row])

    const result = await adoptTemplate(VISITOR, TEMPLATE_ID)

    expect(result).toBeNull()
    expect(inserts).toHaveLength(0)
    expect(getProgramDetail).not.toHaveBeenCalled()
  })

  it('returns null when the template does not exist', async () => {
    selectQueue.push([])

    expect(await adoptTemplate(VISITOR, TEMPLATE_ID)).toBeNull()
    expect(inserts).toHaveLength(0)
  })

  it('returns null when the detail read comes back empty (raced deletion)', async () => {
    selectQueue.push([templateRow()])
    getProgramDetail.mockResolvedValue(undefined)

    expect(await adoptTemplate(VISITOR, TEMPLATE_ID)).toBeNull()
    expect(inserts).toHaveLength(0)
  })
})

describe('getTemplate (the detail read behind /programs/templates/[id])', () => {
  it('returns the system-owned detail when it is a public template', async () => {
    const detail = sourceDetail({
      visibility: 'public',
      status: 'draft',
      userId: TEMPLATE_OWNER_USER_ID,
    })
    getProgramDetail.mockResolvedValue(detail)

    expect(await getTemplate(VISITOR, TEMPLATE_ID)).toBe(detail)
    expect(getProgramDetail).toHaveBeenCalledWith(TEMPLATE_OWNER_USER_ID, TEMPLATE_ID)
  })

  it('collapses non-public and missing rows to the same null (constant-shape 404)', async () => {
    getProgramDetail.mockResolvedValue(
      sourceDetail({ visibility: 'private', status: 'draft', userId: TEMPLATE_OWNER_USER_ID }),
    )
    expect(await getTemplate(VISITOR, TEMPLATE_ID)).toBeNull()

    getProgramDetail.mockResolvedValue(undefined)
    expect(await getTemplate(VISITOR, TEMPLATE_ID)).toBeNull()
  })
})
