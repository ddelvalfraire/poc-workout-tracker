import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { PlanSurface } from './plan-surface'

/**
 * The member's own view. Compare Free against Comped: the comparison list is
 * identical, and the only thing that changes is the line saying where the tier
 * came from — which is exactly the information a member needs before an expiry
 * they did not choose arrives.
 *
 * There is no upgrade button in any story, deliberately. Nothing can be bought
 * yet, and a disabled control that never works reads worse than saying so.
 */
const meta = {
  title: 'Plan/PlanSurface',
  component: PlanSurface,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-md px-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PlanSurface>

export default meta
type Story = StoryObj<typeof meta>

/** The default, and what almost everyone sees. No provenance line. */
export const Free: Story = {
  args: { entitlement: { tier: 'free', source: null, expiresAt: null } },
}

export const Pro: Story = {
  args: {
    entitlement: {
      tier: 'pro',
      source: 'stripe',
      expiresAt: new Date('2026-09-19T00:00:00.000Z'),
    },
  },
}

export const Max: Story = {
  args: {
    entitlement: {
      tier: 'max',
      source: 'stripe',
      expiresAt: new Date('2026-09-19T00:00:00.000Z'),
    },
  },
}

/** A support comp: said plainly, so the end date is never a surprise. */
export const Comped: Story = {
  args: {
    entitlement: {
      tier: 'max',
      source: 'manual',
      expiresAt: new Date('2026-09-19T00:00:00.000Z'),
    },
  },
}

/** A lifetime purchase — no expiry, and the copy says so rather than blanking. */
export const Lifetime: Story = {
  args: { entitlement: { tier: 'pro', source: 'promo', expiresAt: null } },
}
