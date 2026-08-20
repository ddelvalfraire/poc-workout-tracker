import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { AccountAvatar } from './account-avatar'

/**
 * The fallback is the story worth looking at. WorkOS only has a picture when
 * the identity provider supplied one, so an account created any other way
 * renders initials — and an empty circle would read as a broken image rather
 * than a deliberate state.
 */
const meta = {
  title: 'Account/AccountAvatar',
  component: AccountAvatar,
  decorators: [
    (Story) => (
      <div className="p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AccountAvatar>

export default meta
type Story = StoryObj<typeof meta>

/** An inline SVG so the story renders identically with no network. */
const PICTURE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">' +
      '<rect width="96" height="96" fill="#888888"/></svg>',
  )

/** What a Google sign-in gives us: the provider's picture, read-only. */
export const WithPicture: Story = {
  args: {
    src: PICTURE,
    name: 'Ada Lovelace',
    email: 'user@example.test',
  },
}

/** No picture, full name — two initials. */
export const InitialsFromName: Story = {
  args: {
    src: null,
    name: 'Ada Lovelace',
    email: 'user@example.test',
  },
}

/** One name, one initial — never a truncated pair. */
export const InitialsFromSingleName: Story = {
  args: {
    src: null,
    name: 'Ada',
    email: 'user@example.test',
  },
}

/**
 * No picture and no name at all: falls back to the email's first letter,
 * which every account is guaranteed to have.
 */
export const InitialsFromEmail: Story = {
  args: {
    src: null,
    name: '',
    email: 'user@example.test',
  },
}
