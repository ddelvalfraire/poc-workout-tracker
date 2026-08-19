'use client'

import { useState, useSyncExternalStore, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { recordSignupConsentsAction } from './actions'

/**
 * The signup consent screen — implements docs/legal/in-product-copy.md §2
 * under the consent-UX research rules:
 *
 * - Nothing pre-checked; the two health consents are SEPARATE affirmative
 *   acts (MHMDA "separate and distinct"), never a select-all.
 * - Equal visual weight everywhere — no volt on the ask, no confirmshaming
 *   copy on the optional toggle (CPPA symmetry; Honda settlement).
 * - Layered notice: one plain sentence per item, ~80-word Details expander,
 *   full policies linked (never gating the flow).
 * - GPC: if the browser sends Global Privacy Control, the optional
 *   analytics toggle locks off with a visible confirmation (12-state rule;
 *   California requires showing the signal was honored).
 * - This screen's own instrumentation stays anonymous by construction —
 *   identify() cannot run before the consent it asks for exists.
 */

declare global {
  interface Navigator {
    globalPrivacyControl?: boolean
  }
}

interface RowProps {
  id: string
  label: string
  body: string
  detail: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function ConsentRow({ id, label, body, detail, checked, onChange }: RowProps) {
  return (
    <div className="border-b border-border py-4">
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 size-5 shrink-0 accent-primary"
        />
        <span>
          <span className="font-medium">{label}</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{body}</span>
        </span>
      </label>
      <details className="mt-2 pl-8 text-sm text-muted-foreground">
        <summary className="cursor-pointer select-none">Details</summary>
        <p className="mt-1.5 leading-relaxed">{detail}</p>
      </details>
    </div>
  )
}

export function ConsentForm() {
  const [healthCollect, setHealthCollect] = useState(false)
  const [healthShare, setHealthShare] = useState(false)
  const [tos, setTos] = useState(false)
  const [analyticsIdentity, setAnalyticsIdentity] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // GPC is a browser signal — readable only client-side, static for the
  // page's life. useSyncExternalStore reads it without an effect (server
  // snapshot false, so SSR renders the toggle unlocked and hydration
  // corrects it in one pass). Detected = the optional toggle locks off with
  // a visible confirmation (the disclosure California requires), and the
  // submit path forces false regardless of local state.
  const gpc = useSyncExternalStore(
    () => () => {},
    () => Boolean(navigator.globalPrivacyControl),
    () => false,
  )

  const requiredComplete = healthCollect && healthShare && tos

  const router = useRouter()

  function submit() {
    setError(null)
    startTransition(async () => {
      try {
        // The action deliberately does NOT redirect (a server-action
        // redirect rejects the promise, which this catch would misread as
        // failure) — success resolves normally and we navigate here.
        await recordSignupConsentsAction({
          healthCollect,
          healthShare,
          tos,
          analyticsIdentity: gpc ? false : analyticsIdentity,
        })
        router.push('/')
      } catch {
        setError('Something went wrong saving your choices. Please try again.')
      }
    })
  }

  return (
    <div>
      <section aria-labelledby="required-heading">
        <h2
          id="required-heading"
          className="text-xs font-medium tracking-wider text-muted-foreground uppercase"
        >
          Required to use the app
        </h2>
        <ConsentRow
          id="consent-health-collect"
          label="Store your health data"
          body="We collect the workouts, sets, and body-weight entries you record to show your training history and progress."
          detail="This covers everything you log: sessions, exercises, sets and loads, body measurements, progress photos, and notes. It lives in our database, is visible only to you, and you can export or delete it at any time. Full details in the Health Data Privacy policy."
          checked={healthCollect}
          onChange={setHealthCollect}
        />
        <ConsentRow
          id="consent-health-share"
          label="Share with our service providers"
          body="Your data passes through the services that run the app — hosting, database, and the AI coach provider. They process it only for us, never for ads."
          detail="The processors: Vercel (application hosting), Supabase (database), our AI model provider (coach responses only), and Sentry (error reports). Each works under contract, for us alone. Our analytics provider is deliberately NOT on this list — analytics never receives your workout content."
          checked={healthShare}
          onChange={setHealthShare}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          Required because the app can&apos;t function without storing your training.
        </p>
      </section>

      <section aria-labelledby="optional-heading" className="mt-8">
        <h2
          id="optional-heading"
          className="text-xs font-medium tracking-wider text-muted-foreground uppercase"
        >
          Optional
        </h2>
        <div className="flex items-start justify-between gap-4 border-b border-border py-4">
          <div>
            <p className="font-medium">Analytics identity</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Link your usage (never your workout content) to your account so we can see which
              features actually help. Change anytime in Settings.
            </p>
            {gpc && (
              <p id="gpc-note" className="mt-1.5 text-xs text-muted-foreground">
                Your browser sent a Global Privacy Control signal — this stays off.
              </p>
            )}
          </div>
          <label className="mt-1 inline-flex shrink-0 cursor-pointer items-center">
            <input
              type="checkbox"
              role="switch"
              aria-label="Analytics identity"
              aria-describedby={gpc ? 'gpc-note' : undefined}
              checked={analyticsIdentity}
              disabled={gpc}
              onChange={(e) => setAnalyticsIdentity(e.target.checked)}
              className="size-5 accent-primary disabled:opacity-40"
            />
          </label>
        </div>
      </section>

      <p className="mt-6 text-sm text-muted-foreground">
        We never sell your health data. Ever. ·{' '}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          Full privacy policy
        </Link>
      </p>

      <label htmlFor="consent-tos" className="mt-6 flex cursor-pointer items-start gap-3">
        <input
          id="consent-tos"
          type="checkbox"
          checked={tos}
          onChange={(e) => setTos(e.target.checked)}
          className="mt-1 size-5 shrink-0 accent-primary"
        />
        <span className="text-sm">
          I agree to the{' '}
          <Link href="/terms" className="underline underline-offset-2">
            Terms of Service
          </Link>{' '}
          and have read the{' '}
          <Link href="/privacy" className="underline underline-offset-2">
            Privacy Notice
          </Link>{' '}
          and{' '}
          <Link href="/health-privacy" className="underline underline-offset-2">
            Health Data Privacy Policy
          </Link>
          .
        </span>
      </label>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!requiredComplete || pending}
        className="mt-8 w-full rounded-lg bg-primary py-3.5 font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
      >
        {pending ? 'Saving…' : 'Continue'}
      </button>
    </div>
  )
}
