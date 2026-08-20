import { describe, it, expect } from 'vitest'
import { catalogTranslator } from '../../vitest.intl'
import { renderLine, renderLines } from './i18n/message'
import {
  bodyStatusLine,
  bucketDaySets,
  exercisesStatusLine,
  isActiveRoute,
  programProgressPercent,
  programStatusLine,
  recentWorkoutLine,
  relativeDayLabel,
  relativeDayMessage,
  startContextLine,
  trendArrow,
  trophyStatusLine,
  volumeStatusLine,
} from './drawer-status'

/**
 * The drawer's status functions return DESCRIPTORS, so each case asserts the
 * decision (which message, what arguments) and — through the real catalog —
 * what that decision reads as. Segment lists join with the row's " · ", which
 * is punctuation the renderer owns, not a translated word.
 */
const t = catalogTranslator('NavDrawer')
const read = (line: Parameters<typeof renderLine>[1]) => renderLine(t, line)
const readAll = (lines: Parameters<typeof renderLines>[1]) => renderLines(t, lines)

// Local-calendar fixture: a fixed midday "now" keeps day math unambiguous.
const now = new Date(2026, 7, 3, 12, 0, 0) // Mon Aug 3 2026, local

describe('startContextLine', () => {
  it('joins day, week and a lowercased anchor', () => {
    expect(startContextLine('Legs', 3, 'Today')).toEqual({
      key: 'startContextAnchor',
      values: { day: 'Legs', week: 3, anchor: 'today' },
    })
    expect(read(startContextLine('Legs', 3, 'Today'))).toBe('Legs · Week 3 · today')
    expect(read(startContextLine('Push', 1, 'Friday'))).toBe('Push · Week 1 · friday')
  })

  it('drops the anchor segment when unscheduled', () => {
    expect(startContextLine('Legs', 3, null)).toEqual({
      key: 'startContext',
      values: { day: 'Legs', week: 3 },
    })
    expect(read(startContextLine('Legs', 3, null))).toBe('Legs · Week 3')
  })
})

describe('programStatusLine', () => {
  it('renders name and week fraction', () => {
    expect(read(programStatusLine('Upper/Lower Hybrid', 3, 7))).toBe(
      'Upper/Lower Hybrid · Wk 3/7',
    )
  })
})

describe('programProgressPercent', () => {
  it('reports the block fraction, clamped to 0–100', () => {
    expect(programProgressPercent(3, 7)).toBe(43)
    expect(programProgressPercent(7, 7)).toBe(100)
    expect(programProgressPercent(9, 7)).toBe(100)
  })

  it('returns 0 for a zero-week block instead of dividing by it', () => {
    expect(programProgressPercent(1, 0)).toBe(0)
  })
})

describe('volumeStatusLine', () => {
  it('pluralizes sets and nulls out at zero', () => {
    expect(volumeStatusLine(42)).toEqual({ key: 'status.volume', values: { count: 42 } })
    expect(read(volumeStatusLine(42)!)).toBe('42 sets this week')
    expect(read(volumeStatusLine(1)!)).toBe('1 set this week')
    expect(volumeStatusLine(0)).toBeNull()
  })
})

describe('trendArrow', () => {
  it('maps delta to direction with a dead band', () => {
    expect(trendArrow(1.5)).toBe('↗')
    expect(trendArrow(-0.9)).toBe('↘')
    expect(trendArrow(0.1)).toBe('→')
    expect(trendArrow(null)).toBeNull()
  })
})

describe('bodyStatusLine', () => {
  it('joins weight, arrow and a due check-in', () => {
    const line = bodyStatusLine(
      { weightKg: 83.9, deltaKg: -0.9, checkInDue: true, daysSinceLast: 8 },
      'lb',
    )
    // The weight is a literal — a number, a unit and a glyph are data.
    expect(line[0]).toEqual({ literal: '185 lb ↘' })
    expect(line[1]).toEqual({ key: 'status.bodyCheckInDue' })
    expect(readAll(line)).toBe('185 lb ↘ · check-in due')
  })

  it('reports the last check-in when not due', () => {
    expect(
      readAll(
        bodyStatusLine({ weightKg: 80, deltaKg: null, checkInDue: false, daysSinceLast: 3 }, 'kg'),
      ),
    ).toBe('80 kg · last 3d ago')
    expect(
      readAll(
        bodyStatusLine({ weightKg: 80, deltaKg: null, checkInDue: false, daysSinceLast: 0 }, 'kg'),
      ),
    ).toBe('80 kg · checked in today')
  })

  it('still speaks when only one half of the fact exists', () => {
    expect(
      readAll(
        bodyStatusLine(
          { weightKg: null, deltaKg: null, checkInDue: true, daysSinceLast: null },
          'kg',
        ),
      ),
    ).toBe('check-in due')
    expect(
      readAll(
        bodyStatusLine(
          { weightKg: 80, deltaKg: null, checkInDue: false, daysSinceLast: null },
          'kg',
        ),
      ),
    ).toBe('80 kg')
  })

  it('says nothing at all when there is nothing to report', () => {
    expect(
      bodyStatusLine(
        { weightKg: null, deltaKg: null, checkInDue: false, daysSinceLast: null },
        'kg',
      ),
    ).toEqual([])
  })
})

describe('trophyStatusLine', () => {
  it('names the count and the newest', () => {
    expect(trophyStatusLine(12, '315 Squat Club')).toEqual({
      key: 'status.trophiesNewest',
      values: { count: 12, newest: '315 Squat Club' },
    })
    expect(read(trophyStatusLine(12, '315 Squat Club')!)).toBe(
      '12 earned · newest: 315 Squat Club',
    )
    expect(read(trophyStatusLine(2, null)!)).toBe('2 earned')
  })

  it('nulls out when nothing is earned', () => {
    expect(trophyStatusLine(0, null)).toBeNull()
  })
})

describe('exercisesStatusLine', () => {
  it('prefers the PR fact, falls back to the movement count', () => {
    expect(exercisesStatusLine('315 Squat Club', 24)).toEqual({
      key: 'status.lastPr',
      values: { label: '315 Squat Club' },
    })
    expect(read(exercisesStatusLine('315 Squat Club', 24)!)).toBe('Last PR: 315 Squat Club')
    expect(read(exercisesStatusLine(null, 24)!)).toBe('24 logged movements')
    expect(read(exercisesStatusLine(null, 1)!)).toBe('1 logged movement')
    expect(exercisesStatusLine(null, 0)).toBeNull()
  })
})

describe('relativeDayMessage', () => {
  it('speaks local-calendar words for today and yesterday', () => {
    expect(relativeDayMessage(new Date(2026, 7, 3, 7).getTime(), now)).toEqual({
      key: 'day.today',
    })
    expect(relativeDayMessage(new Date(2026, 7, 2, 23).getTime(), now)).toEqual({
      key: 'day.yesterday',
    })
    expect(read(relativeDayMessage(new Date(2026, 7, 3, 7).getTime(), now))).toBe('Today')
    expect(read(relativeDayMessage(new Date(2026, 7, 2, 23).getTime(), now))).toBe('Yesterday')
  })

  it('hands the raw Date to ICU beyond yesterday, never a pre-formatted month', () => {
    const at = new Date(2026, 6, 26, 18)
    // The month name is a locale FORMAT, not a catalog string — the value
    // travels as a Date so a second locale renders its own.
    expect(relativeDayMessage(at.getTime(), now)).toEqual({
      key: 'day.date',
      values: { date: at },
    })
    expect(read(relativeDayMessage(at.getTime(), now))).toBe('Jul 26')
  })
})

describe('relativeDayLabel', () => {
  it('keeps English day words for the not-yet-migrated notes rows', () => {
    expect(relativeDayLabel(new Date(2026, 7, 3, 7).getTime(), now)).toBe('Today')
    expect(relativeDayLabel(new Date(2026, 7, 2, 23).getTime(), now)).toBe('Yesterday')
    expect(relativeDayLabel(new Date(2026, 6, 26, 18).getTime(), now)).toBe('Jul 26')
  })
})

describe('recentWorkoutLine', () => {
  it('joins the day with formatted volume', () => {
    const line = recentWorkoutLine(
      { startedAtMs: new Date(2026, 7, 2, 18).getTime(), volumeKg: 3663 },
      'lb',
      now,
    )
    expect(line[0]).toEqual({ key: 'day.yesterday' })
    expect(line[1]).toEqual({ literal: '8,076 lb' })
    expect(readAll(line)).toBe('Yesterday · 8,076 lb')
  })

  it('drops zero volume', () => {
    expect(
      readAll(
        recentWorkoutLine(
          { startedAtMs: new Date(2026, 7, 3, 8).getTime(), volumeKg: 0 },
          'kg',
          now,
        ),
      ),
    ).toBe('Today')
  })
})

describe('isActiveRoute', () => {
  it('matches exact and nested paths', () => {
    expect(isActiveRoute('/programs', '/programs')).toBe(true)
    expect(isActiveRoute('/programs/abc/stats', '/programs')).toBe(true)
  })

  it('never matches siblings or prefixes without a segment boundary', () => {
    expect(isActiveRoute('/programs-old', '/programs')).toBe(false)
    expect(isActiveRoute('/stats', '/programs')).toBe(false)
  })

  it('treats the root as exact-only', () => {
    expect(isActiveRoute('/', '/')).toBe(true)
    expect(isActiveRoute('/stats', '/')).toBe(false)
  })
})

describe('bucketDaySets', () => {
  const hourMs = 60 * 60 * 1000
  const summary = (hoursAgo: number, sets: number, completed = true) => ({
    startedAt: new Date(now.getTime() - hoursAgo * hourMs),
    completedAt: completed ? new Date(now.getTime() - hoursAgo * hourMs + hourMs) : null,
    completedSetCount: sets,
  })

  it('buckets completed sets into seven rolling 24h blocks, oldest first', () => {
    const buckets = bucketDaySets(
      [summary(1, 8), summary(30, 5), summary(26, 4), summary(6 * 24 + 2, 3)],
      now,
    )
    expect(buckets).toHaveLength(7)
    expect(buckets[6]).toBe(8) // the newest block
    expect(buckets[5]).toBe(9) // 26h and 30h ago share the second block
    expect(buckets[0]).toBe(3) // the oldest block still in the window
  })

  it('ignores unfinished sessions and instants outside the window', () => {
    expect(bucketDaySets([summary(1, 8, false), summary(8 * 24, 5), summary(-2, 4)], now)).toEqual([
      0, 0, 0, 0, 0, 0, 0,
    ])
  })
})
