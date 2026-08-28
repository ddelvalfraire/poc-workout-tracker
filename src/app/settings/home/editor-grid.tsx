'use client'

import { HOME_SECTION_REGISTRY } from '@/lib/home/registry'
import { useTranslations } from 'next-intl'
import type { ResolvedHomeSection } from '@/lib/home/layout'
import { SectionTile, TILE_SPAN } from './section-tile'

/**
 * The miniature live grid: the same 2-col flow home uses (grid-cols-2, sm
 * half-width, md/lg full-width, no dense back-fill), rendered as schematic
 * tiles. This is the whole editor model — what you arrange here is what home
 * lays out.
 *
 * gap-y is the editor's own (real home sections space themselves with mt-*;
 * schematic tiles have no margins to bring). Unknown kinds (a future
 * client's sections) are skipped exactly like home's render map skips them.
 *
 * This static grid is complete on its own — it is also the no-JS/loading
 * fallback once the drag-enabled grid ships on top of it.
 */

export interface EditorGridProps {
  sections: readonly ResolvedHomeSection[]
  /** Tap intent — the editor opens the tile sheet for this section. */
  onOpen: (id: string) => void
}

export function EditorGrid({ sections, onOpen }: EditorGridProps) {
  const t = useTranslations('HomeSection')
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-3">
      {sections.map((section) => {
        const meta = HOME_SECTION_REGISTRY.find((s) => s.kind === section.kind)
        if (!meta) return null // unknown kind (future client): not editable here
        return (
          <div key={section.id} className={TILE_SPAN[section.shape]}>
            <SectionTile
              title={t(meta.titleKey)}
              shape={section.shape}
              hidden={section.hidden}
              onOpen={() => onOpen(section.id)}
            />
          </div>
        )
      })}
    </div>
  )
}
