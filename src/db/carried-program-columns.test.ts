import { describe, it, expect } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { carriedProgramColumns } from './programs'
import { programs } from './schema'
import type { ProgramDetail } from './programs'

/**
 * The ratchet on the `programs` copy paths.
 *
 * `programs` is wide (identity + six independent policy mechanisms +
 * presentation), and every path that mints a program from another one —
 * cloneProgram, adoptTemplate, adoptShared — has to say what travels. When
 * each site enumerated the columns by hand they drifted: `overshoot_policy`
 * travelled with a block restart and was silently dropped by both adopt
 * paths, so an adopted program kept its per-exercise overshoot overrides
 * (those ride copyProgramTree) but lost the program-level default they
 * inherit from. No test caught it because no fixture carried the column.
 *
 * So this test does not check a list of fields — it checks that EVERY column
 * on the table has been classified. Adding a column to `programs` fails here
 * until it is either added to `carriedProgramColumns` or named below with the
 * reason it must not travel. That is the whole cost of the wide table, paid
 * once, in one place.
 */

/** Columns that deliberately do NOT travel with a copy. */
const NEVER_CARRIED = {
  id: 'identity — the copy is a new row',
  userId: 'the caller supplies the new owner',
  name: 'the caller names the copy (a block restart renames, an adopt keeps)',
  status: 'the caller decides the lifecycle slot (draft vs the forced-confirm proposed)',
  authorActor: 'the caller states who authored the copy',
  visibility: 'a copy is a NEW private thing — it never inherits the source reach',
  dietPhase: "a fact about the lifter's CURRENT diet, not about the plan",
  dietPhaseSetAt: 'travels with dietPhase — the staleness signal for a phase that did not travel',
  createdAt: 'stamped fresh by the insert',
  updatedAt: 'stamped fresh by the insert',
} as const

/** A source with every carryable column set to a NON-DEFAULT value, so a
 *  column that silently fails to travel shows up as a missing key rather
 *  than a value that happens to match the column default. */
function source(): ProgramDetail {
  return {
    mesocycleWeeks: 8,
    deloadWeek: 4,
    autoregulation: false,
    autoregStallPolicy: 'first-set',
    deloadPolicy: { mode: 'reactive' },
    overshootPolicy: 'any-metric',
    planSync: false,
    checkInEveryDays: 14,
    notes: 'block two',
    description: 'a description',
    icon: '🏋️',
    heroImageUrl: 'https://example.com/hero.png',
    sourceUrl: 'https://example.com/source',
  } as unknown as ProgramDetail
}

describe('carriedProgramColumns', () => {
  it('classifies every column on the programs table as carried or deliberately not', () => {
    // Arrange
    const all = Object.keys(getTableColumns(programs))

    // Act
    const carried = Object.keys(carriedProgramColumns(source()))

    // Assert — the two sets partition the table exactly. A new policy column
    // lands here first, as a decision, before it can be forgotten by three
    // insert sites.
    const classified = [...carried, ...Object.keys(NEVER_CARRIED)].sort()
    expect(classified).toEqual([...all].sort())
  })

  it('carries the overshoot policy — it encodes the goal, like the deload policy', () => {
    // The regression this file exists for: it travelled with cloneProgram and
    // was dropped by adoptTemplate/adoptShared, so an adopted program scored
    // "beat the target" differently from the plan it was made from.
    expect(carriedProgramColumns(source())).toMatchObject({
      overshootPolicy: 'any-metric',
      deloadPolicy: { mode: 'reactive' },
    })
  })

  it('never carries visibility or the diet phase', () => {
    const carried = carriedProgramColumns(source())
    expect(carried).not.toHaveProperty('visibility')
    expect(carried).not.toHaveProperty('dietPhase')
    expect(carried).not.toHaveProperty('dietPhaseSetAt')
  })
})
