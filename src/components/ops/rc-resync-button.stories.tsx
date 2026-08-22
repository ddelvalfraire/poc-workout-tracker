import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { RcResyncButton } from './rc-resync-button'

/**
 * The support runbook button: re-project a member from RevenueCat's current
 * truth through the same path the webhook uses. Read-repair, so no armed
 * confirm — it can only converge the ledger on what RC attests. In Storybook
 * the action is not wired; pressing it exercises the pending state only.
 */
const meta = {
  title: 'Ops/RcResyncButton',
  component: RcResyncButton,
  args: { userId: 'user_01SYNTHETIC' },
} satisfies Meta<typeof RcResyncButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Where it actually sits: under the member's entitlement summary. */
export const InContext: Story = {
  parameters: { layout: 'padded' },
  render: (args) => (
    <div className="flex w-[min(32rem,calc(100vw-2rem))] flex-col gap-1">
      <p className="text-sm font-medium">someone@example.com</p>
      <p className="text-sm text-muted-foreground">max · until Sep 21, 2026</p>
      <RcResyncButton {...args} />
    </div>
  ),
}
