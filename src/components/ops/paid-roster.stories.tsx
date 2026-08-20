import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { PaidRoster } from './paid-roster'

/**
 * Who is paying, at a glance. Every state the panel can reach: populated,
 * genuinely empty (nobody has bought anything yet — the true state today),
 * and degraded, where the panel says so rather than showing an empty table
 * that would read as "nobody is paying".
 */
const meta = {
  title: 'Ops/PaidRoster',
  component: PaidRoster,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-2xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PaidRoster>

export default meta
type Story = StoryObj<typeof meta>

const DAY = 86_400_000

export const Populated: Story = {
  args: {
    result: {
      ok: true,
      data: [
        {
          userId: 'user_01A',
          email: 'ada@example.test',
          tier: 'max',
          source: 'stripe',
          expiresAt: new Date(Date.now() + 20 * DAY),
          updatedAt: new Date(),
        },
        {
          userId: 'user_01B',
          email: 'grace@example.test',
          tier: 'pro',
          source: 'promo',
          expiresAt: null,
          updatedAt: new Date(),
        },
        // Email lookup failed for this one. The row still appears: the
        // entitlement is the fact, and hiding a paying member because the
        // directory blinked would be the wrong silence.
        {
          userId: 'user_01C',
          email: null,
          tier: 'pro',
          source: 'apple',
          expiresAt: new Date(Date.now() + 5 * DAY),
          updatedAt: new Date(),
        },
      ],
    },
  },
}

export const Empty: Story = { args: { result: { ok: true, data: [] } } }

export const Degraded: Story = {
  args: { result: { ok: false, reason: 'unavailable' } },
}
