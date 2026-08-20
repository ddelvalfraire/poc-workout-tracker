import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { GrantForm } from './grant-form'

/**
 * The two-step confirm is the story. Press Grant once and the button re-reads
 * as the sentence it is about to commit — "Confirm: grant max, No expiry" —
 * and turns destructive. Changing any field disarms it, so the sentence can
 * never describe something other than what the form holds.
 *
 * A reason under three characters is refused before the confirm is even
 * offered: the ledger is only useful if the reason column means something.
 *
 * The grant resolves through `.storybook/mocks/app-actions.ts` with ~600ms of
 * latency, so "Granting…" is visible rather than a flash.
 */
const meta = {
  title: 'Ops/GrantForm',
  component: GrantForm,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-2xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GrantForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { userId: 'user_01JQZ9X7K2N4M6P8R0T2V4W6Y8' },
}
