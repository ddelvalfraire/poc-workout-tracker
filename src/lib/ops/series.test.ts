import { describe, it, expect } from 'vitest'
import { fillDailySeries } from './series'

const END = new Date('2026-08-01T15:30:00Z')

describe('fillDailySeries', () => {
  it('zero-fills missing days across the window, ascending', () => {
    const series = fillDailySeries([{ day: '2026-07-31', value: 3 }], 3, END)
    expect(series).toEqual([
      { day: '2026-07-30', value: 0 },
      { day: '2026-07-31', value: 3 },
      { day: '2026-08-01', value: 0 },
    ])
  })

  it('drops rows outside the window and sums duplicate days', () => {
    const series = fillDailySeries(
      [
        { day: '2026-06-01', value: 99 },
        { day: '2026-08-01', value: 2 },
        { day: '2026-08-01', value: 5 },
      ],
      2,
      END,
    )
    expect(series).toEqual([
      { day: '2026-07-31', value: 0 },
      { day: '2026-08-01', value: 7 },
    ])
  })

  it('spans month boundaries', () => {
    const series = fillDailySeries([], 2, new Date('2026-08-01T00:10:00Z'))
    expect(series.map((p) => p.day)).toEqual(['2026-07-31', '2026-08-01'])
  })

  it('returns an all-zero 14-day window for no rows', () => {
    const series = fillDailySeries([], 14, END)
    expect(series).toHaveLength(14)
    expect(series.every((p) => p.value === 0)).toBe(true)
    expect(series[0].day).toBe('2026-07-19')
    expect(series[13].day).toBe('2026-08-01')
  })
})
