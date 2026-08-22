import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { UpgradePanel, type UpgradeClient, type UpgradeOption } from './upgrade-panel'

/**
 * Checkout on the plan page. Stories inject a fake client through the
 * component's test seam, so every phase renders without RevenueCat: the
 * purchase path resolves instantly and the follow-up sync is the storybook
 * action stub. The real client (Web Billing SDK) is only exercised live.
 */
const OPTIONS: UpgradeOption[] = [
  {
    identifier: 'pro_monthly',
    title: 'Reppen Pro',
    formattedPrice: '$5.00',
    periodDuration: 'P1M',
  },
  {
    identifier: 'max_monthly',
    title: 'Reppen Max',
    formattedPrice: '$13.00',
    periodDuration: 'P1M',
  },
]

function fakeClient(over: Partial<UpgradeClient> = {}): UpgradeClient {
  return {
    loadOptions: async () => OPTIONS,
    purchase: async () => 'purchased',
    ...over,
  }
}

const meta = {
  title: 'Plan/UpgradePanel',
  component: UpgradePanel,
  args: {
    apiKey: 'test_synthetic',
    userId: 'user_01SYNTHETIC',
    client: fakeClient(),
  },
  decorators: [
    (Story) => (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UpgradePanel>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {}

export const Loading: Story = {
  args: {
    client: fakeClient({ loadOptions: () => new Promise(() => {}) }),
  },
}

export const LoadFailed: Story = {
  args: {
    client: fakeClient({
      loadOptions: async () => {
        throw new Error('offerings unavailable')
      },
    }),
  },
}

export const NothingOffered: Story = {
  args: {
    client: fakeClient({ loadOptions: async () => [] }),
  },
}

/** A checkout the member closed: no error, no state change. */
export const CancelledPurchase: Story = {
  args: {
    client: fakeClient({ purchase: async () => 'cancelled' }),
  },
}

export const FailingPurchase: Story = {
  args: {
    client: fakeClient({
      purchase: async () => {
        throw new Error('card declined')
      },
    }),
  },
}
