import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { RcDeadLetters, type DeadLetterRow } from './rc-dead-letters'

/**
 * The dead-letter view: webhook events nobody is coming back for. Resolving
 * requires a reason (the note is the attribution — the inbox has no actor
 * column). In Storybook the action is not wired; the arm/confirm flow and
 * validation are what these stories exercise.
 */
const meta = {
  title: 'Ops/RcDeadLetters',
  component: RcDeadLetters,
} satisfies Meta<typeof RcDeadLetters>

export default meta
type Story = StoryObj<typeof meta>

const ROWS: DeadLetterRow[] = [
  {
    id: 'evt-synthetic-1',
    type: 'INITIAL_PURCHASE',
    appUserId: 'user_01SYNTHETIC',
    status: 'failed',
    attempts: 6,
    lastError:
      'RC API 503 for /v2/projects/proj_synthetic/customers/user_01SYNTHETIC/active_entitlements',
    receivedAtMs: new Date('2026-08-20T09:15:00Z').getTime(),
  },
  {
    id: 'evt-synthetic-2',
    type: 'TRANSFER',
    appUserId: null,
    status: 'orphaned',
    attempts: 1,
    lastError: 'transfer with no resolvable user ids',
    receivedAtMs: new Date('2026-08-19T22:40:00Z').getTime(),
  },
]

export const Empty: Story = {
  args: { rows: [] },
}

export const WithRows: Story = {
  args: { rows: ROWS },
}

/** At its real width: the right-hand column under the paid roster. */
export const InColumn: Story = {
  args: { rows: ROWS },
  parameters: { layout: 'padded' },
  render: (args) => (
    <div className="w-[min(28rem,calc(100vw-2rem))]">
      <RcDeadLetters {...args} />
    </div>
  ),
}
