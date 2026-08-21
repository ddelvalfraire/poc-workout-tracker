'use client'

import { useEffect, useRef, useState, useTransition, type ComponentType } from 'react'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'
import { setHomeLayoutAction } from '@/app/actions'
import { HOME_SECTION_REGISTRY, type HomeSectionSize } from '@/lib/home/registry'
import {
  moveSection,
  moveSectionToTop,
  toggleSection,
  setSectionSize,
  toLayoutDoc,
  resolveHomeLayout,
  type ResolvedHomeSection,
} from '@/lib/home/layout'
import { EditorGrid } from './editor-grid'
import { TileSheet } from './tile-sheet'
import { createDragController } from './drag-controller'
import type { DndGridProps } from './editor-grid-dnd'
import { useTranslations } from 'next-intl'

/**
 * The grid-preview home layout editor: a miniature of home's own 2-col flow
 * grid, in schematic tiles — arrange the miniature, home follows. The locked
 * Status bar leads (lock icon, non-interactive) to teach that the hero is not
 * customizable; tapping any tile opens its bottom sheet (size, visibility,
 * and the Move buttons — the WCAG 2.5.7 non-drag reorder path).
 *
 * Every interaction persists the FULL layout document immediately,
 * optimistically: state flips first, the action writes, failure rolls back to
 * the pre-interaction snapshot. Reset stores NULL — the read path's
 * degrade-to-default IS the reset.
 *
 * Drag is layered on AFTER hydration: the dnd-kit grid is a dynamic import
 * scoped to this route (home's bundle gains zero bytes), and until it loads —
 * or without JS at all — the static grid with the sheet's Move buttons is the
 * complete, WCAG 2.5.7-safe editor. A drag previews by reordering this state
 * live (no persist per move) and commits ONCE on drop.
 */
export function HomeLayoutEditor({
  initialSections,
}: {
  initialSections: ResolvedHomeSection[]
}) {
  const t = useTranslations('HomeLayoutEditor')
  const [sections, setSections] = useState<readonly ResolvedHomeSection[]>(initialSections)
  const [activeKind, setActiveKind] = useState<string | null>(null)
  const [hasError, setHasError] = useState(false)
  const [, startTransition] = useTransition()
  const router = useRouter()
  // Monotonic write counter: only the LATEST write may roll state back or
  // refresh, so a slow earlier failure can't clobber a newer success.
  const writeSeq = useRef(0)
  // The drag-enabled grid, loaded after hydration. Until then (and with JS
  // off) the static EditorGrid renders — same markup, no drag.
  const [DndGrid, setDndGrid] = useState<ComponentType<DndGridProps> | null>(null)
  // Render-fresh mirrors, synced in an effect (never written during render),
  // so the once-created drag controller always reads current state and the
  // current persist closure — drag handlers fire in later tasks, post-effect.
  const sectionsRef = useRef<readonly ResolvedHomeSection[]>(initialSections)
  const persistRef = useRef<typeof persist | null>(null)
  useEffect(() => {
    sectionsRef.current = sections
    persistRef.current = persist
  })
  // The drag lifecycle's tested logic (drag-controller.ts), wired verbatim:
  // preview reorders state only; commit persists ONCE with the pre-drag order
  // as the rollback target; cancel restores the snapshot.
  const [dragController] = useState(() =>
    createDragController({
      getSections: () => sectionsRef.current,
      // Sync the mirror immediately: consecutive previews inside one drag
      // must see each other even before the next render's effect runs.
      setSections: (next) => {
        sectionsRef.current = next
        setSections(next)
      },
      persist: (next, opts) => persistRef.current?.(next, opts),
    }),
  )

  useEffect(() => {
    let cancelled = false
    import('./editor-grid-dnd').then(
      (m) => {
        if (!cancelled) setDndGrid(() => m.DndGrid)
      },
      () => {
        // Chunk failed to load (offline, deploy skew): the static grid stays —
        // the editor is complete without drag.
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  function persist(
    next: readonly ResolvedHomeSection[],
    opts: { reset?: boolean; rollbackTo?: readonly ResolvedHomeSection[] } = {},
  ) {
    const prev = opts.rollbackTo ?? sections
    const seq = ++writeSeq.current
    setSections(next)
    setHasError(false)
    startTransition(async () => {
      try {
        await setHomeLayoutAction(opts.reset === true ? null : toLayoutDoc(next))
        if (seq === writeSeq.current) router.refresh()
      } catch {
        if (seq === writeSeq.current) {
          setSections(prev) // roll back; the grid shows the stored truth
          setHasError(true)
        }
      }
    })
  }

  function onMove(kind: string, direction: 'up' | 'down') {
    const next = moveSection(sections, kind, direction)
    if (next !== sections) persist(next)
  }

  function onMoveToTop(kind: string) {
    const next = moveSectionToTop(sections, kind)
    if (next !== sections) persist(next)
  }

  function onToggle(kind: string) {
    const next = toggleSection(sections, kind)
    if (next !== sections) persist(next)
  }

  function onSize(kind: string, size: HomeSectionSize) {
    const next = setSectionSize(sections, kind, size)
    if (next !== sections) persist(next)
  }

  function onReset() {
    setActiveKind(null)
    persist(resolveHomeLayout(null), { reset: true })
  }

  const activeIndex = sections.findIndex((s) => s.kind === activeKind)
  const activeSection = activeIndex === -1 ? null : sections[activeIndex]
  const activeMeta =
    activeSection === null
      ? null
      : (HOME_SECTION_REGISTRY.find((s) => s.kind === activeSection.kind) ?? null)

  return (
    <>
      {/* The locked bar: Status always renders, always first. Present but
          non-interactive — its stillness above the live tiles teaches the
          model faster than any explanation. */}
      <div
        aria-label={t('lockedTileAriaLabel')}
        className="mt-6 mb-3 flex items-center gap-3 rounded-lg border border-border/60 px-3 py-3.5"
      >
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t('lockedTileLabel')}
        </span>
        <span aria-hidden="true" className="h-2 flex-1 rounded bg-muted" />
        <Lock aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </div>

      {DndGrid !== null ? (
        <DndGrid
          sections={sections}
          onOpen={setActiveKind}
          onDragStart={dragController.onDragStart}
          onDragPreview={dragController.onDragPreview}
          onDragCommit={dragController.onDragCommit}
          onDragCancel={dragController.onDragCancel}
        />
      ) : (
        <EditorGrid sections={sections} onOpen={setActiveKind} />
      )}

      <p className="mt-4 text-sm text-muted-foreground">
        {t('hint')}
      </p>
      {hasError && (
        <p className="mt-2 text-sm text-destructive" role="status">
          {t('saveError')}
        </p>
      )}

      <button
        type="button"
        onClick={onReset}
        className="mt-8 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
      >
        {t('resetAction')}
      </button>

      {activeSection !== null && activeMeta !== null && (
        <TileSheet
          meta={activeMeta}
          section={activeSection}
          index={activeIndex}
          count={sections.length}
          onClose={() => setActiveKind(null)}
          onSize={(size) => onSize(activeSection.kind, size)}
          onToggle={() => onToggle(activeSection.kind)}
          onMove={(direction) => onMove(activeSection.kind, direction)}
          onMoveToTop={() => onMoveToTop(activeSection.kind)}
        />
      )}
    </>
  )
}
