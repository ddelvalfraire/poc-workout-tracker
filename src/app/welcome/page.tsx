import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireUserId } from '@/lib/auth'
import { hasConsent } from '@/db/consent'
import { ConsentForm } from './consent-form'

export const metadata: Metadata = { title: 'Your data, your call' }

/**
 * The signup consent step (in-product-copy.md §2). New accounts land here
 * from the home gate until the required consents exist; a user who already
 * consented gets bounced straight home (idempotent — revisiting the URL is
 * harmless).
 */
export default async function WelcomePage() {
  const userId = await requireUserId()
  if (await hasConsent(userId, 'tos')) redirect('/')
  return (
    <main className="mx-auto w-full max-w-md px-5 pt-10 pb-16">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">Your data, your call</h1>
      <p className="mt-2 text-muted-foreground">
        Washington law gives you real choices here. Each one in plain English.
      </p>
      <div className="mt-8">
        <ConsentForm />
      </div>
    </main>
  )
}
