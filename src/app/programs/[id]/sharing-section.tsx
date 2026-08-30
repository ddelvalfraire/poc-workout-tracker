'use client'

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import { Check, Copy } from 'lucide-react'
import type { ProgramVisibility } from '@/lib/program-input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import { setProgramVisibilityAction, rotateProgramShareAction } from '../actions'
import { useTranslations } from 'next-intl'

/** The three visibility modes, as VALUES only. Their labels and blurbs
 *  live in the catalog (`option.<value>` / `optionDescription.<value>`):
 *  copy built at module load happens before any request, so it could
 *  never be translated. */
const OPTIONS: ProgramVisibility[] = ['private', 'link', 'public']

const COPIED_RESET_MS = 2000

/** Static-value subscription for useSyncExternalStore: never notifies. */
function subscribeNever(): () => void {
  return () => {}
}

interface SharingSectionProps {
  programId: string
  visibility: ProgramVisibility
  /** The live share token (null until a link is minted). */
  shareToken: string | null
}

/**
 * The owner's sharing controls on the program page: segmented visibility
 * selector, the share URL + copy when non-private, and revoke-and-rotate
 * behind a ConfirmDialog. The link is minted LAZILY by the server action on
 * the first switch away from Private; rotate is the only path to a new token.
 * Never rendered on proposals (the page gates it, and the db layer refuses
 * regardless).
 */
export function SharingSection({ programId, visibility, shareToken }: SharingSectionProps) {
  const t = useTranslations('SharingSection')
  const [current, setCurrent] = useState<ProgramVisibility>(visibility)
  const [token, setToken] = useState<string | null>(shareToken)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showRotate, setShowRotate] = useState(false)
  const [isPending, startTransition] = useTransition()
  const closeRef = useRef<(() => void) | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The live origin as a client-only external value: the server snapshot is
  // null (this component still SERVER-renders first, where `window` doesn't
  // exist) and the URL row hydrates in. Composing from the origin means
  // preview and production deployments each hand out their own host without
  // config. The subscribe is a no-op — the origin never changes in-page.
  const origin = useSyncExternalStore(
    subscribeNever,
    () => window.location.origin,
    () => null,
  )

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  const shareUrl = token !== null && origin !== null ? `${origin}/p/${token}` : null

  function select(next: ProgramVisibility) {
    if (isPending || next === current) return
    setError(null)
    startTransition(async () => {
      try {
        const result = await setProgramVisibilityAction(programId, next)
        setCurrent(result.visibility)
        setToken(result.token ?? token)
      } catch {
        setError(t('updateError'))
      }
    })
  }

  function copyLink() {
    if (shareUrl === null) return
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopied(true)
        if (copyTimer.current) clearTimeout(copyTimer.current)
        copyTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS)
      })
      .catch(() => setError(t('copyError')))
  }

  function rotate() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await rotateProgramShareAction(programId)
        setToken(result.token)
        closeRef.current?.()
        setShowRotate(false)
      } catch {
        setError(t('rotateError'))
      }
    })
  }

  return (
    <section aria-label={t('ariaLabel')} className="mt-10">
      <h2 className="font-display text-xl uppercase leading-none tracking-wide">{t('title')}</h2>
      {/* Segmented selector — the week-pill vocabulary, one selected at a time. */}
      <div role="group" aria-label={t('visibilityGroupLabel')} className="mt-3 flex flex-wrap gap-2">
        {OPTIONS.map((option) => {
          const isSelected = option === current
          return (
            <button
              key={option}
              type="button"
              aria-pressed={isSelected}
              disabled={isPending}
              onClick={() => select(option)}
              className={cn(
                'flex h-9 items-center rounded-full border px-3.5 text-sm font-semibold transition-colors disabled:opacity-60',
                isSelected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`option.${option}`)}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{t(`optionDescription.${current}`)}</p>

      {current !== 'private' && shareUrl !== null && (
        <div className="mt-3 border-b border-b-border/60 pb-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t('shareLinkLabel')}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm tnum">{shareUrl}</p>
            <button
              type="button"
              onClick={copyLink}
              aria-label={copied ? t('copiedAriaLabel') : t('copyAriaLabel')}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              {copied ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <Copy aria-hidden="true" className="size-4" />
              )}
              {copied ? t('copiedAction') : t('copyAction')}
            </button>
          </div>
          <button
            type="button"
            disabled={isPending}
            onClick={() => setShowRotate(true)}
            className="mt-3 text-sm text-muted-foreground underline underline-offset-2 transition-colors hover:text-destructive disabled:opacity-60"
          >
            {t('rotateAction')}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {showRotate && (
        <ConfirmDialog
          title={t('rotateDialog.title')}
          body={t('rotateDialog.body')}
          confirmLabel={t('rotateDialog.confirm')}
          pendingLabel={t('rotateDialog.pending')}
          error={error}
          isPending={isPending}
          onConfirm={rotate}
          onClose={() => setShowRotate(false)}
          closeRef={closeRef}
        />
      )}
    </section>
  )
}
