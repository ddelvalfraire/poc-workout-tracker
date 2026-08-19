import { requireUserId } from '@/lib/auth'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { DeleteAccountForm } from './delete-account-form'

/**
 * The account-deletion surface — in-app (App Store / Google Play both require
 * it) AND web-reachable at this URL from any browser (Google Play
 * additionally requires a deletion path outside the app; this route is it —
 * signing in is permitted by the policy, creating identity friction is not).
 * The copy states exactly what dies and what is retained, in the privacy
 * policy's own terms: consent records survive pseudonymized (CA ARL keeps us
 * to >= 3 years), everything else is erased.
 */
export default async function DeleteAccountPage() {
  await requireUserId()

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader title="Delete account" leading={<BackLink fallback="/settings" />} />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <section aria-label="What deletion does" className="mt-6">
          <p className="text-sm text-muted-foreground">
            Deleting your account is permanent. There is no undo, and no grace period.
          </p>
          <ul className="mt-4 space-y-2 border-b border-b-border/60 pb-4 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Erased immediately:</span> your
              workouts, programs, templates, notes, goals, trophies, body measurements,
              progress photos, custom exercises, preferences, and coach conversations.
            </li>
            <li>
              <span className="font-medium text-foreground">Told to erase:</span> our analytics
              processor deletes your profile and events; your sign-in account is removed.
            </li>
            <li>
              <span className="font-medium text-foreground">Retained:</span> consent records we
              are legally required to keep (at least 3 years), with your identity replaced by
              a random code that cannot be traced back to you.
            </li>
          </ul>
        </section>

        <DeleteAccountForm />
      </main>
    </div>
  )
}
