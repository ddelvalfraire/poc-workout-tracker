// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import IntlMessageFormat from 'intl-messageformat'
import messages from '../../../messages/en.json'

/**
 * coach-chat.tsx renders behind a live chat transport, so its messages are
 * exercised at the catalog level instead: the conversions that could break
 * are the plurals and the disclosure wording, not the JSX around them.
 *
 * The disclosure strings are a compliance surface — they must read exactly as
 * shipped, so they are asserted verbatim rather than by shape.
 */
const format = (message: string, values: Record<string, unknown>) =>
  String(new IntlMessageFormat(message, 'en').format(values))

describe('CoachChat messages', () => {
  it('pluralizes the proposal day count', () => {
    expect(format(messages.CoachChat.proposalDays, { days: 1 })).toBe('1 day/week')
    expect(format(messages.CoachChat.proposalDays, { days: 4 })).toBe('4 days/week')
  })

  it('pluralizes the proposal week count', () => {
    expect(format(messages.CoachChat.proposalWeeks, { weeks: 1 })).toBe('1 week')
    expect(format(messages.CoachChat.proposalWeeks, { weeks: 6 })).toBe('6 weeks')
  })

  it('keeps the AI disclosure wording exactly as shipped', () => {
    // Regulatory copy: relocating it into the catalog must not reword it.
    expect(messages.CoachChat.disclosureStrip).toBe(
      'AI coach — responses are AI-generated and can be wrong. Not medical advice.',
    )
  })

  it('carries no HTML entity that a JSON message would ship literally', () => {
    // Grouped keys (toolRunning.*, starter.*, chip.*) make the namespace a
    // tree, so the walk recurses rather than assuming one flat level.
    const leaves = (node: object, prefix: string): [string, string][] =>
      Object.entries(node).flatMap(([key, value]) =>
        typeof value === 'string'
          ? [[`${prefix}.${key}`, value] as [string, string]]
          : leaves(value as object, `${prefix}.${key}`),
      )

    for (const [path, value] of [
      ...leaves(messages.CoachChat, 'CoachChat'),
      ...leaves(messages.CoachToolCall, 'CoachToolCall'),
      ...leaves(messages.CoachDisclosure, 'CoachDisclosure'),
    ]) {
      expect(value, path).not.toMatch(/&[a-z]+;/i)
    }
  })
})
