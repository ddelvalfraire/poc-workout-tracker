import { describe, it, expect } from 'vitest'
import { parseWeekParam, resolveDayState } from './week-view'

describe('parseWeekParam', () => {
  it('returns the current week when the param is absent', () => {
    expect(parseWeekParam(undefined, 3, 8)).toBe(3)
  })

  it('parses a plain numeric week', () => {
    expect(parseWeekParam('5', 3, 8)).toBe(5)
  })

  it('takes the first value of a repeated param', () => {
    expect(parseWeekParam(['2', '7'], 3, 8)).toBe(2)
  })

  it('falls back to the current week on non-numeric input', () => {
    expect(parseWeekParam('banana', 3, 8)).toBe(3)
    expect(parseWeekParam('', 3, 8)).toBe(3)
  })

  it('clamps below-range and above-range weeks into 1..mesocycleWeeks', () => {
    expect(parseWeekParam('0', 3, 8)).toBe(1)
    expect(parseWeekParam('-4', 3, 8)).toBe(1)
    expect(parseWeekParam('99', 3, 8)).toBe(8)
  })

  it('truncates fractional weeks (parseInt semantics)', () => {
    expect(parseWeekParam('2.9', 3, 8)).toBe(2)
  })
})

const at = (iso: string) => new Date(iso)
const row = (startedAt: string, completedAt: string | null, id = startedAt) => ({
  id,
  startedAt: at(startedAt),
  completedAt: completedAt === null ? null : at(completedAt),
})

describe('resolveDayState', () => {
  it('returns null when the day has no workouts for the week', () => {
    expect(resolveDayState([])).toBeNull()
  })

  it('reports a completed workout as completed', () => {
    const done = row('2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z')
    expect(resolveDayState([done])).toEqual({ state: 'completed', workout: done })
  })

  it('reports an unfinished workout as in-progress', () => {
    const live = row('2026-07-01T10:00:00Z', null)
    expect(resolveDayState([live])).toEqual({ state: 'in-progress', workout: live })
  })

  it('lets completed beat in-progress even when the in-progress row is fresher', () => {
    const done = row('2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z', 'done')
    const abandoned = row('2026-07-02T10:00:00Z', null, 'abandoned')
    expect(resolveDayState([abandoned, done])).toEqual({ state: 'completed', workout: done })
  })

  it('picks the freshest row within a state regardless of input order', () => {
    const older = row('2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z', 'older')
    const newer = row('2026-07-03T10:00:00Z', '2026-07-03T11:00:00Z', 'newer')
    expect(resolveDayState([older, newer])).toEqual({ state: 'completed', workout: newer })
    expect(resolveDayState([newer, older])).toEqual({ state: 'completed', workout: newer })
  })
})

/**
 * The user-visible half of the full-replace provenance story, whose write side
 * lives in db/program-provenance.test.ts.
 *
 * `updateProgram` deletes and re-inserts `program_days`, minting new ids, and
 * `workouts.program_day_id` is ON DELETE SET NULL — so the save DOES null the
 * link. What keeps the day card honest is the re-attach: the recreated day
 * inherits the old day's durable `slotKey`, and every workout carrying that
 * slot key is re-pointed at the new row id inside the same transaction. The
 * detail page buckets by exactly that id (page.tsx: the `w.programDayId ===
 * day.id && w.programWeek === selectedWeek` filter feeding resolveDayState),
 * so a completed day must still read completed after a save.
 *
 * These cases began as the characterization suite that PROVED the loss; each
 * one is now its inversion. The predicate is inlined here because page.tsx is
 * an async server component and does not export it; keep the two in step.
 */
const bucketForDay = <T extends { programDayId: string | null; programWeek: number | null }>(
  rows: T[],
  dayId: string,
  selectedWeek: number,
) => rows.filter((w) => w.programDayId === dayId && w.programWeek === selectedWeek)

/** The re-attach, as the page sees it: a workout whose slot survived the save
 *  comes back holding the RECREATED day's id. */
const afterSave = <T extends { programDayId: string | null }>(row: T, newDayId: string | null) => ({
  ...row,
  programDayId: newDayId,
})

describe('day-card state after a full-replace plan save (provenance preserved)', () => {
  const completedPush = {
    id: 'w1',
    programDayId: 'day-old-1' as string | null,
    programWeek: 2 as number | null,
    startedAt: at('2026-07-01T10:00:00Z'),
    completedAt: at('2026-07-01T11:00:00Z') as Date | null,
  }

  it('renders the completed day BEFORE the save (control)', () => {
    // Arrange — the day still carries the id the workout was stamped with
    const rows = bucketForDay([completedPush], 'day-old-1', 2)

    // Act
    const state = resolveDayState(rows)

    // Assert
    expect(state).toEqual({ state: 'completed', workout: completedPush })
  })

  it('STILL renders completed once the day id is re-minted by the save', () => {
    // Arrange — the day was re-inserted under its old slot key, so the
    // re-attach moved the workout onto the new row id
    const repointed = afterSave(completedPush, 'day-new-1')

    // Act
    const state = resolveDayState(bucketForDay([repointed], 'day-new-1', 2))

    // Assert — the trained session is visible; no Start button for a session
    // already trained
    expect(state).toEqual({ state: 'completed', workout: repointed })
  })

  it('keeps every week of the day, not just the edited week', () => {
    // Arrange — three weeks of completed Push sessions, all re-pointed by the
    // one re-attach (it matches on the slot, not the week)
    const history = [1, 2, 3].map((week) =>
      afterSave({ ...completedPush, id: `w${week}`, programWeek: week as number | null }, 'day-new-1'),
    )

    // Act — each week's bucket against the recreated day id
    const states = [1, 2, 3].map((week) => resolveDayState(bucketForDay(history, 'day-new-1', week)))

    // Assert — the whole column still reads trained
    expect(states.map((s) => s?.state)).toEqual(['completed', 'completed', 'completed'])
  })

  it('reads untouched for a day the user genuinely DELETED', () => {
    // Arrange — no slot to inherit, so the SET NULL stands. The session is not
    // silently re-attached to whichever day slid into that position; the
    // workout keeps its frozen programDayName instead (db/schema.ts).
    const orphaned = afterSave(completedPush, null)

    // Act / Assert — no day id can ever match null
    expect(resolveDayState(bucketForDay([orphaned], 'day-new-1', 2))).toBeNull()
    expect(resolveDayState(bucketForDay([orphaned], 'day-old-1', 2))).toBeNull()
  })
})
