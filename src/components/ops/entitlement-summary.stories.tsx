import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { EntitlementSummary } from './entitlement-summary'
import type { BillingSnapshot } from '@/lib/ops/entitlements'

/**
 * The header of a support lookup. The story worth comparing is Comped against
 * Subscribed: the tier reads the same, and the line underneath is the entire
 * difference between "they are paying" and "somebody gave them this".
 */
const meta = {
  title: 'Ops/EntitlementSummary',
  component: EntitlementSummary,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-2xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EntitlementSummary>

export default meta
type Story = StoryObj<typeof meta>

const USER: BillingSnapshot['user'] = {
  id: 'user_01JQZ9X7K2N4M6P8R0T2V4W6Y8',
  email: 'ada@example.test',
  firstName: 'Ada',
  lastName: 'Lovelace',
  createdAt: '2026-01-04T09:00:00.000Z',
}

/** A fixed instant, never Date.now(): a story that moves with the clock is a
 *  story that cannot be diffed. */
const AS_OF_MS = Date.parse('2026-02-01T12:00:00.000Z')

function snapshot(effective: BillingSnapshot['effective']): BillingSnapshot {
  return { user: USER, effective, grants: [], asOfMs: AS_OF_MS }
}

/** Nothing granted — the default tier, with no provenance line at all. */
export const FreeTier: Story = {
  args: { snapshot: snapshot({ tier: 'free', source: null, expiresAt: null }) },
}

/** A paying member: the source names the processor. */
export const Subscribed: Story = {
  args: {
    snapshot: snapshot({
      tier: 'pro',
      source: 'stripe',
      expiresAt: new Date('2026-09-19T00:00:00.000Z'),
    }),
  },
}

/** A support comp with an end date somebody chose. */
export const Comped: Story = {
  args: {
    snapshot: snapshot({
      tier: 'max',
      source: 'manual',
      expiresAt: new Date('2026-09-19T00:00:00.000Z'),
    }),
  },
}

/**
 * Perpetual. Called out in words rather than left blank, because "never
 * expires" is the most consequential thing this screen can say.
 */
export const Perpetual: Story = {
  args: { snapshot: snapshot({ tier: 'max', source: 'manual', expiresAt: null }) },
}

/** No name on the account: the email carries the identity on its own. */
export const NoName: Story = {
  args: {
    snapshot: {
      user: { ...USER, firstName: null, lastName: null },
      effective: { tier: 'free', source: null, expiresAt: null },
      grants: [],
      asOfMs: AS_OF_MS,
    },
  },
}
