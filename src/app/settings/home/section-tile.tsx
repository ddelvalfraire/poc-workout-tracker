import { useTranslations } from 'next-intl'
import type { HomeSectionSize } from '@/lib/home/registry'
import { cn } from '@/lib/utils'

/**
 * One schematic tile in the grid-preview editor: the kind's condensed-caps
 * title over a shape-true skeleton (plain bg-muted bars — the Ghost geometry
 * without the pending animation; nothing here is loading). NO data fetches —
 * the tile previews the section's footprint, never its content.
 *
 * The whole tile is one button (tap → the tile sheet). A hidden section stays
 * in place, dimmed — hiding is not removing.
 */

/** The editor's copy of home's span mapping (home-sections.tsx SIZE_SPAN):
 *  the preview must flow exactly like the real 2-col grid. Kept separate on
 *  purpose — the home render path stays untouched by the editor. */
export const TILE_SPAN: Record<HomeSectionSize, string> = {
  sm: 'col-span-1',
  md: 'col-span-2',
  lg: 'col-span-2',
}

/** Shape-true footprints: sm is a compact half-width stat, md a full row,
 *  lg a taller stack of rows. Explicit heights so a size change animates
 *  (motion-safe) instead of snapping. */
const TILE_HEIGHT: Record<HomeSectionSize, string> = {
  sm: 'h-24',
  md: 'h-24',
  lg: 'h-40',
}

/** Skeleton bars per size — a numeral-ish block for sm, list rows for md/lg. */
const TILE_BARS: Record<HomeSectionSize, readonly string[]> = {
  sm: ['h-5 w-1/2', 'h-2 w-3/4'],
  md: ['h-2 w-full', 'h-2 w-full', 'h-2 w-2/3'],
  lg: ['h-2 w-full', 'h-2 w-full', 'h-2 w-full', 'h-2 w-full', 'h-2 w-2/3'],
}

export interface SectionTileProps {
  title: string
  size: HomeSectionSize
  hidden: boolean
  onOpen: () => void
}

export function SectionTile({ title, size, hidden, onOpen }: SectionTileProps) {
  const t = useTranslations('SectionTile')
  return (
    <button
      type="button"
      onClick={onOpen}
      // One ICU message with a select, not a sentence assembled from a size
      // word and a template literal: the size noun and the section name sit
      // in different places once the sentence is translated.
      aria-label={t('ariaLabel', { section: title, state: hidden ? 'hidden' : size })}
      className={cn(
        'flex w-full flex-col items-start gap-2.5 overflow-hidden rounded-lg border border-border/60 p-3 text-left',
        'transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
        'motion-safe:transition-all motion-safe:duration-200',
        TILE_HEIGHT[size],
        hidden && 'opacity-40',
      )}
    >
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </span>
      <span aria-hidden="true" className="flex w-full flex-1 flex-col justify-between gap-1.5">
        {TILE_BARS[size].map((bar, i) => (
          <span key={i} className={cn('block rounded bg-muted', bar)} />
        ))}
      </span>
    </button>
  )
}
