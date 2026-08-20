import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { TierBadge } from './tier-badge'
import { TIERS } from '@/lib/entitlements/tiers'

/**
 * Three states of one pill. Free is deliberately the quietest — most members
 * are on it, and a loud badge on the default tier would make the ops tables
 * read as though everyone were noteworthy.
 */
const meta = {
  title: 'Ops/TierBadge',
  component: TierBadge,
  decorators: [
    (Story) => (
      <div className="p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TierBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Free: Story = { args: { tier: 'free' } }
export const Pro: Story = { args: { tier: 'pro' } }
export const Max: Story = { args: { tier: 'max' } }

/** All three side by side — the only way to judge the weight difference. */
export const AllTiers: Story = {
  args: { tier: 'free' },
  render: () => (
    <div className="flex gap-2">
      {TIERS.map((tier) => (
        <TierBadge key={tier} tier={tier} />
      ))}
    </div>
  ),
}
