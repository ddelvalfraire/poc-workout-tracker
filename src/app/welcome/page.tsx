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
    // Mobile: single thumb-friendly column. Desktop (lg+): the intro becomes
    // a sticky left pane and the form takes a bounded right column — a form
    // never earns 1440px of width, but the page earns a real desktop layout.
    <main className="mx-auto w-full max-w-md px-[clamp(1.25rem,4vw,2.5rem)] pt-[clamp(2rem,1rem+4vw,5rem)] pb-16 lg:grid lg:max-w-5xl lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start lg:gap-20">
      <header className="lg:sticky lg:top-16">
        <h1 className="text-[clamp(1.875rem,1.3rem+2.4vw,3rem)] leading-tight font-semibold tracking-tight text-balance">
          Your data, your call
        </h1>
        <p className="mt-3 max-w-[42ch] text-muted-foreground lg:mt-4 lg:text-lg lg:leading-relaxed">
          Washington law gives you real choices here. Each one in plain English.
        </p>
        <p className="mt-6 hidden max-w-[42ch] text-sm leading-relaxed text-muted-foreground lg:block">
          Two of these are required — they are what the app is. One is optional and off by
          default. All of them can be revisited in Settings.
        </p>
      </header>
      <div className="mt-8 lg:mt-1">
        <ConsentForm />
      </div>
    </main>
  )
}
