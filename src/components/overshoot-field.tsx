'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronRight, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { useAnimatedSheetClose } from '@/components/use-animated-sheet-close'
import { cn } from '@/lib/utils'
import type { OvershootPolicy } from '@/lib/overshoot-policy'

/**
 * "What counts as beating the target", as a row that opens a sheet.
 *
 * The control this replaces was a bare `<select>` offering four words —
 * default / strict / e1RM-equivalent / any metric — with no statement of what
 * any of them DO. Nobody can choose between four pieces of jargon, so in
 * practice nobody chose: the field was decoration on a screen people were
 * trying to read. Four labels in a dropdown is not a decision surface.
 *
 * So every option states its own consequence in a sentence, and the sheet
 * closes with the rule applied to THIS movement's actual prescription — the
 * difference between picking a policy and picking an outcome. A setting whose
 * effect you can only discover by training under it for three weeks is a
 * setting you have not really been offered.
 *
 * `null` leads the list and is a real choice, not an absence: it defers to the
 * program policy, then to the scheme's own default. It also names what that
 * resolves to right now, because "default" alone just moves the question.
 */

const POLICY_KEYS = {
  'strict-load': 'strictLoad',
  'e1rm-equivalent': 'e1rmEquivalent',
  'any-metric': 'anyMetric',
} as const

const POLICIES = Object.keys(POLICY_KEYS) as OvershootPolicy[]

/** What a movement is actually asked for, for the sheet's closing line. Null
 *  when the caller has no concrete prescription to show — a program-level
 *  default, or an exercise with no load-bearing set yet. */
export interface OvershootPreview {
  /** Already formatted for display, e.g. "5" or "8–12". */
  reps: string
  /** Already formatted WITH its unit, e.g. "120 kg". */
  load: string
}

interface OvershootFieldProps {
  value: OvershootPolicy | null
  onChange: (value: OvershootPolicy | null) => void
  /**
   * Whose policy this is. An exercise names itself so the heading and the
   * aria-label stay unambiguous when several rows sit on one screen; the
   * program-level row has no name to give.
   */
  exerciseName?: string
  /**
   * What `null` resolves to for this subject right now — the program's own
   * policy for an exercise row, the scheme default for the program row.
   * Without it, "Scheme default" is a label that answers nothing.
   */
  resolvesTo: OvershootPolicy
  preview?: OvershootPreview | null
  className?: string
}

export function OvershootField({
  value,
  onChange,
  exerciseName,
  resolvesTo,
  preview = null,
  className,
}: OvershootFieldProps) {
  const t = useTranslations('OvershootField')
  const tCommon = useTranslations('Common')
  const [isOpen, setIsOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const requestClose = useAnimatedSheetClose(dialogRef, () => setIsOpen(false))

  useEffect(() => {
    if (!isOpen) return
    // showModal(), never the `open` attribute: a non-modal dialog paints no
    // ::backdrop (so the scrim class would be inert), traps no focus, and
    // never enters the top layer. StrictMode-guarded, with a manual body
    // scroll lock and focus restore — the same mechanics as every other sheet
    // in the app.
    const dialog = dialogRef.current
    const active = document.activeElement
    const previouslyFocused =
      active instanceof HTMLElement && !dialog?.contains(active) ? active : null
    if (dialog && !dialog.open) dialog.showModal()
    closeButtonRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      // Explicitly release the top layer (the stranded-::backdrop rule).
      if (dialog?.open) dialog.close()
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [isOpen])

  const currentKey = value === null ? 'default' : POLICY_KEYS[value]
  const scope = exerciseName ?? null
  const sheetLabel =
    scope === null ? t('ariaLabelProgram') : t('ariaLabelExercise', { exerciseName: scope })

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={sheetLabel}
        className={cn(
          'flex w-full items-center justify-between gap-4 py-3 text-left text-sm transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
          className,
        )}
      >
        <span className="shrink-0">{t('label')}</span>
        <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
          <span className="truncate">{t(`option.${currentKey}`)}</span>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
        </span>
      </button>

      {isOpen && (
        <dialog
          ref={dialogRef}
          aria-label={sheetLabel}
          onCancel={(e) => {
            e.preventDefault() // open/closed state stays owned by React
            requestClose()
          }}
          onClick={(e) => {
            // Geometric backdrop test, not `target === dialog`: a tap in the
            // sheet's own padding must not dismiss it.
            const rect = dialogRef.current?.getBoundingClientRect()
            if (!rect) return
            const inside =
              e.clientX >= rect.left &&
              e.clientX <= rect.right &&
              e.clientY >= rect.top &&
              e.clientY <= rect.bottom
            if (!inside) requestClose()
          }}
          className="mx-auto mt-auto mb-0 max-h-[85dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl border-x border-t border-border bg-card px-5 pt-5 pb-safe text-foreground backdrop:bg-black/60 motion-safe:animate-sheet-up"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {scope !== null && (
                <p className="truncate text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {scope}
                </p>
              )}
              <h3 className="mt-0.5 text-lg leading-tight">{t('label')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t('lede')}</p>
            </div>
            <Button
              ref={closeButtonRef}
              size="icon-sm"
              variant="ghost"
              className="-mr-1 shrink-0 text-muted-foreground"
              onClick={requestClose}
              aria-label={tCommon('close')}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>

          <ul className="mt-4 divide-y divide-border/60 border-y border-y-border/60">
            {[null, ...POLICIES].map((policy) => {
              const key = policy === null ? 'default' : POLICY_KEYS[policy]
              const selected = policy === value
              return (
                <li key={key}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      onChange(policy)
                      requestClose()
                    }}
                    className="flex w-full items-start gap-3 py-3.5 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
                  >
                    <span className="mt-0.5 w-4 shrink-0">
                      {selected && <Check aria-hidden="true" className="size-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{t(`option.${key}`)}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">
                        {/* The default names what it currently resolves to —
                            "default" on its own just moves the question. */}
                        {policy === null
                          ? t('consequence.default', {
                              resolved: t(`option.${POLICY_KEYS[resolvesTo]}`),
                            })
                          : t(`consequence.${key}`)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {preview !== null && (
            // The rule applied to what this movement is actually asked for.
            // Without it the whole sheet is still four abstractions.
            <div className="mt-4 mb-4 rounded-lg bg-muted/40 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t('preview.title')}
              </p>
              <p className="tnum mt-1.5 text-sm leading-5 text-muted-foreground">
                {t('preview.ask', { reps: preview.reps, load: preview.load })}{' '}
                {t(`preview.${currentKey}`, { load: preview.load })}
              </p>
            </div>
          )}
        </dialog>
      )}
    </>
  )
}
