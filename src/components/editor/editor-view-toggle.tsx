import Link from 'next/link'
import { useTranslations } from 'next-intl'

import type { EditorView } from '@/app/programs/[id]/editor/editor-address'
import { cn } from '@/lib/utils'

/** ARIA token values are part of the HTML vocabulary, never copy. */
const ARIA_CURRENT_TRUE = 'true'

const VIEWS = ['day', 'exercise'] as const satisfies readonly EditorView[]

/**
 * Which way pane 2 reads the block: one day across one week, or one day across
 * every week.
 *
 * LINKS, NOT BUTTONS. The reading is part of the address, so switching it has
 * to be a navigation or Back would not undo it — and both projections then
 * inherit it for free, exactly as they inherit the selected day. It is also why
 * this is a plain server component with no state: there is nothing to hold.
 *
 * `replace`, because a reading is a lens on the same place rather than a new
 * place. Someone flipping between the two four times should still be one Back
 * press from wherever they came in.
 */
interface EditorViewToggleProps {
  view: EditorView
  /** The current address, re-minted for the given reading. */
  hrefForView: (view: EditorView) => string
  className?: string
}

function EditorViewToggle({ view, hrefForView, className }: EditorViewToggleProps) {
  const t = useTranslations('ProgramEditor')

  return (
    <div className={cn('flex gap-2', className)} role="group" aria-label={t('viewLabel')}>
      {VIEWS.map((option) => (
        <Link
          key={option}
          href={hrefForView(option)}
          replace
          aria-current={view === option ? ARIA_CURRENT_TRUE : undefined}
          className={cn(
            'relative flex h-9 items-center rounded-full border px-3.5 text-sm font-semibold transition-colors outline-none before:absolute before:-inset-1 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
            view === option
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-muted text-muted-foreground',
          )}
        >
          {t(option === 'day' ? 'viewByDay' : 'viewByExercise')}
        </Link>
      ))}
    </div>
  )
}

export { EditorViewToggle }
