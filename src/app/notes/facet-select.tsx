'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { notesHref, type NotesFilterParams } from '@/components/notes/note-view'
import { cn } from '@/lib/utils'

/**
 * The Exercise/Program picker chip: a native select wearing the facet-chip
 * recipe (the drafts' "Exercise ▾"), so the phone's own picker does the
 * heavy lifting — no popover to build, still one tap. Choosing pushes the
 * next /notes URL (URL as state, same contract as the link chips beside it);
 * the empty option clears the facet.
 */
export function FacetSelect({
  param,
  params,
  options,
}: {
  param: 'exercise' | 'program'
  params: NotesFilterParams
  options: string[]
}) {
  // Keyed off `param`, not a label prop: the accessible name and the trigger
  // are one sentence each per facet, so neither can be assembled from a
  // lowercased noun the way the English original did.
  const t = useTranslations('FacetSelect')
  const router = useRouter()
  const value = params[param]
  return (
    <select
      aria-label={t(`ariaLabel.${param}`)}
      value={value ?? ''}
      onChange={(event) => {
        const next = event.target.value === '' ? null : event.target.value
        router.push(notesHref({ ...params, [param]: next }), { scroll: false })
      }}
      className={cn(
        'shrink-0 appearance-none rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors',
        value !== null
          ? 'bg-primary/15 text-primary'
          : 'bg-muted text-muted-foreground active:bg-muted/60',
      )}
    >
      <option value="">{t(`trigger.${param}`)}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  )
}
