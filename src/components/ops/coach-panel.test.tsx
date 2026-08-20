import { describe, expect, test } from 'vitest'
import { renderStaticIntl } from '../../../vitest.intl'
import { CoachPanel } from './coach-panel'
import type { OpsResult } from '@/lib/ops/types'
import type { LangfuseSnapshot, LangfuseTracesSnapshot } from '@/lib/ops/langfuse'

/**
 * Money and latency reach the table as a bare "$" beside a number, and a
 * number beside "s" — a currency symbol that trails the amount in most of
 * Europe, and a unit abbreviation that is not "s" everywhere. Both are ICU
 * messages with arguments now; these pin that the argument actually lands
 * rather than the raw pattern shipping to the board.
 */

const daily: OpsResult<LangfuseSnapshot> = {
  ok: true,
  data: {
    totalTraces: 12,
    totalCost: 1.5,
    totalCost7d: 0.75,
    days: [{ date: '2026-03-04', traces: 12, totalCost: 1.5 }],
  } as LangfuseSnapshot,
}

const traces: OpsResult<LangfuseTracesSnapshot> = {
  ok: true,
  data: {
    traces: [
      {
        time: '2026-03-04T10:00:00.000Z',
        name: 'coach.reply',
        model: 'sonnet',
        latencyMs: 2400,
        tokens: 1234,
        totalCost: 0.0123,
      },
    ],
  } as LangfuseTracesSnapshot,
}

const emptyTraces: OpsResult<LangfuseTracesSnapshot> = {
  ok: true,
  data: { traces: [] } as LangfuseTracesSnapshot,
}

describe('CoachPanel copy', () => {
  test('formats the headline spend through the currency message', () => {
    const html = renderStaticIntl(<CoachPanel daily={daily} traces={emptyTraces} />)

    expect(html).toContain('$1.50')
    expect(html).toContain('$0.75')
    expect(html).not.toContain('{amount}')
  })

  test('formats each row’s latency and cost through their messages', () => {
    const html = renderStaticIntl(<CoachPanel daily={daily} traces={traces} />)

    expect(html).toContain('2.4s')
    expect(html).toContain('$0.0123')
    expect(html).not.toContain('{seconds}')
  })

  test('names the generations table and its columns', () => {
    const html = renderStaticIntl(<CoachPanel daily={daily} traces={traces} />)

    expect(html).toContain('Recent generations')
    expect(html).toContain('When (UTC)')
    expect(html).toContain('Latency')
    expect(html).toContain('Tokens')
  })

  test('degrades the table on its own without blanking the panel', () => {
    const html = renderStaticIntl(
      <CoachPanel daily={daily} traces={{ ok: false, reason: 'unavailable' }} />,
    )

    expect(html).toContain('Traces list unavailable. It refreshes on reload.')
    expect(html).toContain('$1.50')
  })

  test('says the coach has not run yet rather than showing an empty table', () => {
    const html = renderStaticIntl(<CoachPanel daily={daily} traces={emptyTraces} />)

    expect(html).toContain('No generations yet.')
  })

  test('resolves every key it references', () => {
    const html = renderStaticIntl(<CoachPanel daily={daily} traces={traces} />)

    expect(html).not.toMatch(/CoachPanel\.[a-zA-Z.]+/)
  })
})
