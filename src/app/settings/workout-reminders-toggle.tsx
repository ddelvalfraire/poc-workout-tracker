'use client'

import { useEffect, useState } from 'react'
import { urlBase64ToUint8Array } from '@/lib/push-client'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

/**
 * The push-notification opt-in — same switch idiom as RestTimerToggle, but
 * the truth is the BROWSER'S subscription (getSubscription() on mount), not a
 * server flag: the server only mirrors what this device actually holds.
 *
 * iOS one-shot discipline: Notification.requestPermission() runs ONLY inside
 * the toggle's click handler (a real user gesture) — never on load, never
 * speculatively. A 'denied' permission renders the switch disabled with an
 * explanation; unsupported browsers get a hint instead of a dead control.
 */

type SupportState =
  | 'pending' // still probing on mount
  | 'unsupported' // no Push API (or no VAPID key baked in)
  | 'denied' // permission refused — only the browser can undo this
  | 'ready'

export function WorkoutRemindersToggle() {
  const t = useTranslations('WorkoutRemindersToggle')
  const [support, setSupport] = useState<SupportState>('pending')
  const [isOn, setIsOn] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [hasError, setHasError] = useState(false)

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

  useEffect(() => {
    let cancelled = false
    async function probe() {
      if (
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window) ||
        !vapidKey
      ) {
        setSupport('unsupported')
        return
      }
      if (Notification.permission === 'denied') {
        setSupport('denied')
        return
      }
      // getRegistration (not .ready) so a missing worker resolves instead of
      // hanging the probe forever.
      const registration = await navigator.serviceWorker.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      if (cancelled) return
      setIsOn(Boolean(subscription))
      setSupport('ready')
    }
    probe().catch(() => setSupport('unsupported'))
    return () => {
      cancelled = true
    }
  }, [vapidKey])

  async function subscribe(): Promise<void> {
    // The one permission prompt iOS ever grants — it must live inside this
    // gesture-driven handler.
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      setSupport(permission === 'denied' ? 'denied' : 'ready')
      throw new Error('permission not granted')
    }
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey as string) as BufferSource,
    })
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON()),
    })
    if (!res.ok) {
      // The server never learned about this subscription — drop it so the
      // switch's truth (the browser) matches the server again.
      await subscription.unsubscribe().catch(() => {})
      throw new Error('subscribe failed')
    }
  }

  async function unsubscribe(): Promise<void> {
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) return // already gone — the off state is already true
    const endpoint = subscription.endpoint
    await subscription.unsubscribe()
    // Best-effort server cleanup: the browser-side unsubscribe already killed
    // delivery; a dangling row gets pruned on the next send (404/410).
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {})
  }

  function toggle() {
    if (isBusy) return
    const next = !isOn
    setIsOn(next) // optimistic — a settings switch must feel instant
    setHasError(false)
    setIsBusy(true)
    const run = next ? subscribe() : unsubscribe()
    run
      .catch(() => {
        setIsOn(!next) // roll back; the switch shows the browser's truth
        setHasError(true)
      })
      .finally(() => setIsBusy(false))
  }

  if (support === 'unsupported') {
    return (
      <p className="max-w-40 text-right text-xs text-muted-foreground">
        {t('unsupportedNotice')}
      </p>
    )
  }

  const isDenied = support === 'denied'

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label={t('ariaLabel')}
        disabled={isBusy || isDenied || support === 'pending'}
        onClick={toggle}
        // 44px effective target via the invisible inset on a compact track.
        className={cn(
          'relative h-7 w-12 rounded-full border transition-colors before:absolute before:-inset-2',
          'outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
          isOn ? 'border-primary bg-primary' : 'border-border bg-muted',
          isDenied && 'opacity-50',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-0.5 left-0.5 size-[22px] rounded-full transition-transform',
            isOn ? 'translate-x-5 bg-primary-foreground' : 'translate-x-0 bg-muted-foreground',
          )}
        />
      </button>
      {isDenied && (
        <p className="max-w-40 text-right text-xs text-muted-foreground">
          {t('blockedNotice')}
        </p>
      )}
      {hasError && (
        <p className="text-xs text-destructive" role="status">
          {t('updateError')}
        </p>
      )}
    </div>
  )
}
