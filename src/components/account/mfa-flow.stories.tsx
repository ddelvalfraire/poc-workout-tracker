import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { MfaFlow } from './mfa-flow'

/**
 * The enrolment flow, walkable end to end without a WorkOS environment: the
 * server actions resolve to `.storybook/mocks/app-actions.ts`, which returns
 * the success branch at each step with ~600ms of latency so the in-flight
 * states ("Sending…", "Checking…", disabled buttons) are actually visible.
 *
 * Start on `Enroll`, press through, and the three screens appear in order:
 * ask for a code → enter the emailed code → add the key and confirm.
 *
 * `ResumedAfterAppSwitch` is the one worth looking at closely. It is what a
 * user sees coming back from their authenticator app after the PWA was
 * backgrounded and its JS context discarded — the SAME secret replayed from
 * the server, never a freshly minted one, because a new secret at that moment
 * silently invalidates whatever they already saved.
 */
const meta = {
  title: 'Account/MfaFlow',
  component: MfaFlow,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-md px-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MfaFlow>

export default meta
type Story = StoryObj<typeof meta>

/** A synthetic factor: real base32, real otpauth:// shape. */
const PENDING = {
  secret: 'JBSWY3DPEHPK3PXP',
  uri: 'otpauth://totp/Workout%20Tracker:you@example.test?secret=JBSWY3DPEHPK3PXP&issuer=Workout%20Tracker',
  qrCode: '',
}

/**
 * Step one of turning MFA on. The recovery notice is deliberate: WorkOS has
 * no backup codes, so the honest statement is that the inbox IS the recovery
 * path — implying a printable escape hatch would be a lie users pay for.
 */
export const Enroll: Story = {
  args: { mode: 'enroll' },
}

/**
 * Returning mid-enrolment. Skips straight to the key because the factor was
 * already issued and stored server-side.
 */
export const ResumedAfterAppSwitch: Story = {
  args: { mode: 'enroll', pending: PENDING },
}

/**
 * Turning MFA off — same emailed-code step-up as enrolment. Deliberately NOT
 * a type-to-confirm gate: that friction belongs to account deletion, which is
 * irreversible, and spending it on a reversible toggle is how users learn to
 * type past warnings.
 */
export const Disable: Story = {
  args: { mode: 'disable' },
}
