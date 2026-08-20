import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { GrantLedger } from './grant-ledger'
import type { EntitlementGrant } from '@/db/entitlements'

/**
 * The history table, revoked rows included — which is the point of the
 * component. A ledger that showed only live grants could answer "why do they
 * have this" but not "why did they lose it", and support gets asked the
 * second question far more often.
 *
 * Revoking resolves through `.storybook/mocks/app-actions.ts` with ~600ms of
 * latency, so the in-flight label is visible rather than a flash.
 */
const meta = {
  title: 'Ops/GrantLedger',
  component: GrantLedger,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-4xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GrantLedger>

export default meta
type Story = StoryObj<typeof meta>

const DAY = 86_400_000
/** Pinned so the lapsed/live split in MixedHistory is the same every run. */
const NOW = Date.now()

function grant(over: Partial<EntitlementGrant> = {}): EntitlementGrant {
  return {
    id: 'grant_1',
    userId: 'user_01JQZ9X7K2N4M6P8R0T2V4W6Y8',
    tier: 'pro',
    source: 'stripe',
    sourceRef: 'sub_1QaBcDeFgHiJkLmN',
    status: 'active',
    startsAt: new Date(Date.now() - 10 * DAY),
    endsAt: new Date(Date.now() + 20 * DAY),
    reason: 'stripe: invoice.paid',
    actorId: null,
    revokedAt: null,
    revokedReason: null,
    revokedByActorId: null,
    createdAt: new Date(Date.now() - 10 * DAY),
    ...over,
  }
}

/** Nothing on file: the member is on the default tier and always has been. */
export const Empty: Story = { args: { grants: [], now: NOW } }

/** A single live subscription — the ordinary case. */
export const OneLiveGrant: Story = { args: { grants: [grant()], now: NOW } }

/** A perpetual comp, with the operator who granted it named on the row. */
export const PerpetualComp: Story = {
  args: {
    now: NOW,
    grants: [
      grant({
        id: 'grant_2',
        tier: 'max',
        source: 'manual',
        sourceRef: null,
        endsAt: null,
        reason: 'Founding user — thanks for the bug reports',
        actorId: 'user_01OPSADMIN000000000000000',
      }),
    ],
  },
}

/**
 * The full story of one account: a comp that was revoked, a subscription that
 * lapsed on its own, and a live one. The three end-states look different on
 * purpose — "revoked" is somebody's decision, "lapsed" is nobody's.
 */
export const MixedHistory: Story = {
  args: {
    now: NOW,
    grants: [
      grant({ id: 'g3', tier: 'max', source: 'stripe', sourceRef: 'sub_live' }),
      grant({
        id: 'g2',
        tier: 'pro',
        source: 'stripe',
        sourceRef: 'sub_old',
        startsAt: new Date(Date.now() - 90 * DAY),
        endsAt: new Date(Date.now() - 30 * DAY),
        createdAt: new Date(Date.now() - 90 * DAY),
      }),
      grant({
        id: 'g1',
        tier: 'max',
        source: 'manual',
        sourceRef: null,
        status: 'revoked',
        endsAt: null,
        reason: 'Trial of Max for feedback',
        actorId: 'user_01OPSADMIN000000000000000',
        revokedAt: new Date(Date.now() - 60 * DAY),
        revokedReason: 'Trial period over, member subscribed',
        revokedByActorId: 'user_01OPSADMIN000000000000000',
        createdAt: new Date(Date.now() - 120 * DAY),
      }),
    ],
  },
}
