'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import {
  startMfaSetupAction,
  confirmMfaSetupAction,
  cancelMfaSetupAction,
  disableMfaAction,
} from '@/app/settings/account/mfa/actions'

/**
 * The TOTP enrolment and removal flow.
 *
 * Three UI decisions here are load-bearing rather than stylistic.
 *
 * ONE INPUT, NOT SIX BOXES. Six single-character inputs break paste, break
 * `autocomplete="one-time-code"` autofill, and read atrociously to a screen
 * reader. WCAG 2.2 SC 3.3.8 treats transcribing a code as a cognitive
 * function test that passes only if the user can paste or autofill it, so the
 * segmented version is a conformance failure as well as a usability one.
 *
 * DEEP LINK BEFORE QR. On a phone the QR is useless — the camera is on the
 * device showing it. The otpauth:// link hands the secret to the authenticator
 * in one tap; the copy-key button is the universal fallback; the QR is folded
 * away for the case it actually serves, scanning from a second device.
 *
 * NEVER OPTIMISTIC. Security state flips only after the server confirms it. A
 * toggle that reads "On" before verification succeeds is a lie about whether
 * the account is protected.
 */

type Mode = 'enroll' | 'disable'
type Step = 'idle' | 'showing-secret' | 'done'

interface MfaFlowProps {
  mode: Mode
  /** Replays a factor already issued, so a returning user sees one secret. */
  pending?: { secret: string; uri: string; qrCode: string } | null
}

export function MfaFlow({ mode, pending = null }: MfaFlowProps) {
  const t = useTranslations('Mfa')
  const tCommon = useTranslations('Common')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [step, setStep] = useState<Step>(pending ? 'showing-secret' : 'idle')
  const [factor, setFactor] = useState(pending)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function beginEnrollment() {
    setMessage(null)
    startTransition(async () => {
      const result = await startMfaSetupAction()
      if (result.status === 'enrolled') {
        setFactor({ secret: result.secret, uri: result.uri, qrCode: result.qrCode })
        setStep('showing-secret')
        setCode('')
        return
      }
      setMessage(
        result.status === 'already-enrolled' ? t('errorAlreadyEnrolled') : t('errorUnavailable'),
      )
    })
  }

  function submitAuthenticatorCode() {
    setMessage(null)
    startTransition(async () => {
      const result = await confirmMfaSetupAction(code)
      if (result.status === 'verified') {
        setStep('done')
        router.refresh()
        return
      }
      if (result.status === 'invalid-code') return setMessage(t('errorWrongCode'))
      // The factor was discarded server-side, so the screen must go back to
      // the start rather than leave a secret on display that cannot verify.
      setFactor(null)
      setStep('idle')
      setMessage(t('errorSetupExpired'))
    })
  }

  function turnOff() {
    setMessage(null)
    startTransition(async () => {
      const result = await disableMfaAction()
      if (result.status === 'removed') {
        setStep('done')
        router.refresh()
        return
      }
      if (result.status === 'blocked-required') return setMessage(t('errorRequiredHere'))
      setMessage(t('errorReauthRequired'))
    })
  }

  function cancel() {
    startTransition(async () => {
      await cancelMfaSetupAction()
      setStep('idle')
      setFactor(null)
      setCode('')
      setMessage(null)
    })
  }

  async function copySecret() {
    if (!factor) return
    await navigator.clipboard.writeText(factor.secret)
    setCopied(true)
    // Reverts so the label never outlives the clipboard it describes.
    setTimeout(() => setCopied(false), 2_000)
  }

  if (step === 'done') {
    return (
      <Section title={mode === 'enroll' ? t('doneEnrollTitle') : t('doneDisableTitle')}>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === 'enroll' ? t('doneEnrollBody') : t('doneDisableBody')}
        </p>
        <Button className="mt-6 w-full" onClick={() => router.push('/settings/account')}>
          {t('doneAction')}
        </Button>
      </Section>
    )
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      {step === 'idle' && (
        <>
          <p className="text-sm text-muted-foreground">
            {mode === 'enroll' ? t('introEnroll') : t('introDisable')}
          </p>
          {/* Stated plainly because WorkOS has no backup codes: losing the
              phone means asking a human, and implying otherwise would set the
              user up to lose their history. */}
          {mode === 'enroll' && (
            <p className="text-sm text-muted-foreground">{t('recoveryNotice')}</p>
          )}
          <Button onClick={mode === 'enroll' ? beginEnrollment : turnOff} disabled={isPending}>
            {isPending ? t('working') : mode === 'enroll' ? t('beginAction') : t('turnOffAction')}
          </Button>
          {message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
        </>
      )}

      {step === 'showing-secret' && factor && (
        <>
          <p className="text-sm text-muted-foreground">{t('setupInstructions')}</p>

          {/* Primary on mobile: one tap into the authenticator app. A real
              anchor, not a scripted navigation — the OS resolves otpauth://
              to the installed app, and an <a> keeps that reachable by
              keyboard and assistive tech. */}
          <a href={factor.uri} className={buttonVariants({ className: 'w-full' })}>
            {t('openAuthenticatorAction')}
          </a>

          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">{t('manualKeyLabel')}</p>
            <code className="block break-all rounded-lg bg-muted px-3 py-2 text-sm tracking-wider">
              {factor.secret}
            </code>
            <Button variant="outline" onClick={copySecret} type="button">
              {copied ? t('copiedLabel') : t('copyKeyAction')}
            </Button>
          </div>

          {/* Folded away: only useful when scanning from a SECOND device. */}
          {factor.qrCode && (
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                {t('qrToggle')}
              </summary>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={factor.qrCode}
                alt={t('qrAlt')}
                className="mt-3 size-48 rounded-lg bg-white p-2"
              />
            </details>
          )}

          <CodeField
            label={t('authenticatorCodeLabel')}
            value={code}
            onChange={setCode}
            disabled={isPending}
            error={message}
          />
          <div className="flex gap-3">
            <Button onClick={submitAuthenticatorCode} disabled={isPending || code.length < 6}>
              {isPending ? t('checking') : t('turnOnAction')}
            </Button>
            <Button variant="ghost" onClick={cancel} disabled={isPending}>
              {tCommon('cancel')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * One numeric field, never a row of boxes.
 *
 * `autocomplete="one-time-code"` lets iOS/Android and password managers fill
 * it, and paste is left alone — both are what SC 3.3.8 requires. Submission is
 * an explicit button press: auto-submitting on the sixth character races a
 * paste and denies a typo any chance of correction.
 */
function CodeField({
  label,
  value,
  onChange,
  disabled,
  error,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  disabled: boolean
  error: string | null
}) {
  const id = 'mfa-code'
  const errorId = `${id}-error`

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        // Strip non-digits so a pasted "123 456" still works.
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="text-lg tracking-[0.3em] tnum"
      />
      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
