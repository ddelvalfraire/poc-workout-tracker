import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { NameEditor } from './name-editor'

/**
 * The Save button starts DISABLED and only wakes once a field actually
 * differs from what was loaded — type in one to see it. A live Save on an
 * untouched form invites a pointless round-trip and reads as though the
 * screen is waiting on the user.
 *
 * The save itself resolves through `.storybook/mocks/app-actions.ts` with
 * ~600ms of latency, so the "Saving…" state is visible rather than a flash.
 */
const meta = {
  title: 'Account/NameEditor',
  component: NameEditor,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-md px-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NameEditor>

export default meta
type Story = StoryObj<typeof meta>

/** Editing a name that is already set. */
export const Existing: Story = {
  args: {
    initialFirstName: 'Ada',
    initialLastName: 'Lovelace',
  },
}

/**
 * An account with no name yet — WorkOS leaves both fields null when the
 * identity provider supplied none, so empty is a real starting state rather
 * than an edge case.
 */
export const Empty: Story = {
  args: {
    initialFirstName: '',
    initialLastName: '',
  },
}

/** Only a first name: clearing the surname is a legitimate edit, not an error. */
export const FirstNameOnly: Story = {
  args: {
    initialFirstName: 'Ada',
    initialLastName: '',
  },
}
