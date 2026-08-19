'use client'

import { useState, useSyncExternalStore, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { recordSignupConsentsAction } from './actions'

/**
 * The signup consent screen — implements docs/legal/in-product-copy.md §2
 * with the app's own control vocabulary (DESIGN.md), not native inputs:
 * check rows follow the de-card grammar (hairline dividers, whole-row 44px
 * targets, volt only on affirmative state), the switch is the settings
 * track+thumb pattern, and the CTA is the Button primitive.
 *
 * Consent rules (research-backed, unchanged from v1): nothing pre-checked,
 * the two health consents are separate affirmative acts, equal visual
 * weight, GPC locks the optional toggle with a visible confirmation, and
 * the action deliberately does not redirect (success resolves; we navigate).
 */

declare global {
  interface Navigator {
    globalPrivacyControl?: boolean
  }
}

/** De-carded consent row: whole-row toggle, drawn check, hairline divider. */
function ConsentRow({
  id,
  label,
  body,
  detail,
  checked,
  onChange,
}: {
  id: string
  label: string
  body: string
  detail: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-border py-4">
      <button
        type="button"
        id={id}
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="group flex w-full cursor-pointer items-start gap-3.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span
          aria-hidden="true"
          className={cn(
            // 44px effective target via the invisible inset on a compact box.
            'relative mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors before:absolute before:-inset-2.5',
            checked
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-transparent group-hover:border-muted-foreground',
          )}
        >
          <Check
            className={cn('size-4 transition-opacity', checked ? 'opacity-100' : 'opacity-0')}
            strokeWidth={3}
          />
        </span>
        <span className="min-w-0">
          <span className="font-medium">{label}</span>
          <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">
            {body}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-2 ml-[38px] flex items-center gap-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        What this means
        <ChevronDown
          className={cn('size-3.5 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {open && (
        <p className="mt-2 ml-[38px] text-sm leading-relaxed text-muted-foreground">{detail}</p>
      )}
    </div>
  )
}

/** The settings track+thumb switch (rest-timer pattern), consent-sized. */
function ConsentSwitch({
  checked,
  disabled,
  describedBy,
  onChange,
}: {
  checked: boolean
  disabled: boolean
  describedBy?: string
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Analytics identity"
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full border transition-colors before:absolute before:-inset-2',
        'outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40',
        checked ? 'border-primary bg-primary' : 'border-border bg-muted',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0.5 left-0.5 size-[22px] rounded-full transition-transform',
          checked ? 'translate-x-5 bg-primary-foreground' : 'translate-x-0 bg-muted-foreground',
        )}
      />
    </button>
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
  // page's life; server snapshot false, hydration corrects in one pass.
  const gpc = useSyncExternalStore(
    () => () => {},
    () => Boolean(navigator.globalPrivacyControl),
    () => false,
  )
  const router = useRouter()

  const requiredComplete = healthCollect && healthShare && tos

  function submit() {
    setError(null)
    startTransition(async () => {
      try {
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
          className="border-b border-border pb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase"
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

      <section aria-labelledby="optional-heading" className="mt-9">
        <h2
          id="optional-heading"
          className="border-b border-border pb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase"
        >
          Optional
        </h2>
        <div className="flex items-start justify-between gap-4 border-b border-border py-4">
          <div className="min-w-0">
            <p className="font-medium">Analytics identity</p>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
              Link your usage (never your workout content) to your account so we can see which
              features actually help. Change anytime in Settings.
            </p>
            {gpc && (
              <p id="gpc-note" className="mt-1.5 text-xs text-muted-foreground">
                Your browser sent a Global Privacy Control signal — this stays off.
              </p>
            )}
          </div>
          <div className="mt-1">
            <ConsentSwitch
              checked={gpc ? false : analyticsIdentity}
              disabled={gpc}
              describedBy={gpc ? 'gpc-note' : undefined}
              onChange={setAnalyticsIdentity}
            />
          </div>
        </div>
      </section>

      <p className="mt-6 text-sm text-muted-foreground">
        We never sell your health data. Ever. ·{' '}
        <Link
          href="/privacy"
          className="underline underline-offset-2 hover:text-foreground"
          target="_blank"
        >
          Full privacy policy
        </Link>
      </p>

      <div className="mt-7 border-t border-border pt-5">
        <button
          type="button"
          id="consent-tos"
          role="checkbox"
          aria-checked={tos}
          onClick={() => setTos((v) => !v)}
          className="group flex w-full cursor-pointer items-start gap-3.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span
            aria-hidden="true"
            className={cn(
              'relative mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors before:absolute before:-inset-2.5',
              tos
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-transparent group-hover:border-muted-foreground',
            )}
          >
            <Check
              className={cn('size-4 transition-opacity', tos ? 'opacity-100' : 'opacity-0')}
              strokeWidth={3}
            />
          </span>
          <span className="text-sm leading-relaxed">
            I agree to the Terms of Service and have read the Privacy Notice and Health Data
            Privacy Policy.
          </span>
        </button>
        <p className="mt-2 ml-[38px] text-xs text-muted-foreground">
          Read them:{' '}
          <Link href="/terms" target="_blank" className="underline underline-offset-2">
            Terms
          </Link>
          {' · '}
          <Link href="/privacy" target="_blank" className="underline underline-offset-2">
            Privacy
          </Link>
          {' · '}
          <Link href="/health-privacy" target="_blank" className="underline underline-offset-2">
            Health Data
          </Link>
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button
        type="button"
        size="lg"
        onClick={submit}
        disabled={!requiredComplete || pending}
        className="mt-8 w-full"
      >
        {pending ? 'Saving…' : 'Continue'}
      </Button>
    </div>
  )
}
