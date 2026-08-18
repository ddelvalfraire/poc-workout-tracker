'use client'

import { useRouter } from 'next/navigation'
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
  label,
  param,
  params,
  options,
}: {
  label: string
  param: 'exercise' | 'program'
  params: NotesFilterParams
  options: string[]
}) {
  const router = useRouter()
  const value = params[param]
  return (
    <select
      aria-label={`Filter by ${label.toLowerCase()}`}
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
      <option value="">{label} ▾</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  )
}
