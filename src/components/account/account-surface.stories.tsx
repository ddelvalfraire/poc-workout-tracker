import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { AccountSurface } from './account-surface'
import type { AccountOverview } from '@/lib/workos/account-model'

/**
 * Every state here is set by a WorkOS ENVIRONMENT setting rather than by app
 * data, so none of them can be produced on demand by clicking through the
 * running app — flipping MFA on is a dashboard change against a live auth
 * environment. These stories are how the copy and the conditional rows get
 * reviewed before any of that is touched.
 */
const meta = {
  title: 'Account/AccountSurface',
  component: AccountSurface,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-md px-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AccountSurface>

export default meta
type Story = StoryObj<typeof meta>

const base: AccountOverview = {
  email: 'user@example.test',
  emailVerified: true,
  firstName: 'Ada',
  lastName: 'Lovelace',
  profilePictureUrl: null,
  connectedAccounts: ['GoogleOAuth'],
  mfaAvailable: false,
  mfaRequired: false,
  hasMfaFactor: false,
}

/**
 * Today's production reality: Google only, no password, and MFA off for the
 * environment — so no MFA row renders at all. The connected-accounts hint
 * switches to its sole-method warning, which is the lockout guard speaking.
 */
export const OAuthOnlyMfaOff: Story = {
  args: { account: base },
}

/** MFA available but not yet enrolled — the row appears, reading "Off". */
export const MfaAvailableNotEnrolled: Story = {
  args: { account: { ...base, mfaAvailable: true } },
}

/** Enrolled. The one state that proves the two mfaEnabled fields stay apart. */
export const MfaEnrolled: Story = {
  args: { account: { ...base, mfaAvailable: true, hasMfaFactor: true } },
}

/** Environment mandates MFA — the hint changes from invitation to statement. */
export const MfaRequired: Story = {
  args: { account: { ...base, mfaAvailable: true, mfaRequired: true, hasMfaFactor: true } },
}

/** Mid-verification: the email row carries the unverified hint. */
export const EmailUnverified: Story = {
  args: { account: { ...base, emailVerified: false } },
}

/** Several providers linked — unlinking any one is safe here. */
export const MultipleProviders: Story = {
  args: {
    account: { ...base, connectedAccounts: ['GoogleOAuth', 'AppleOAuth'], mfaAvailable: true },
  },
}

/** No name yet — the value falls back to muted words, never an empty gap. */
export const NameNotSet: Story = {
  args: { account: { ...base, firstName: null, lastName: null } },
}
