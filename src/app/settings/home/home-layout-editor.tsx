'use client'

import { useEffect, useRef, useState, useTransition, type ComponentType } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Plus } from 'lucide-react'
import { setHomeLayoutAction } from '@/app/actions'
import {
  HOME_SECTION_REGISTRY,
  type HomeSectionMeta,
  type HomeSectionShape,
} from '@/lib/home/registry'
import {
  moveSection,
  moveSectionToTop,
  toggleSection,
  setSectionShape,
  addSection,
  removeSection,
  isExtraInstance,
  toLayoutDoc,
  type ResolvedHomeSection,
} from '@/lib/home/layout'
import { applyPreset, layoutForPreset, matchPreset, type HomePresetId } from '@/lib/home/presets'
import type { TrainingSignal } from '@/lib/home/signal'
import { EditorGrid } from './editor-grid'
import { GallerySheet } from './gallery-sheet'
import { PresetRow } from './preset-row'
import { TileSheet } from './tile-sheet'
import { createDragController } from './drag-controller'
import type { DndGridProps } from './editor-grid-dnd'
import { useTranslations } from 'next-intl'

/** The registry widened to its declared interface — the `as const satisfies`
 *  literal type drops OPTIONAL fields (`repeatable`) from the entries that
 *  omit them, and the gallery is entirely a question about those. */
const REGISTRY: readonly HomeSectionMeta[] = HOME_SECTION_REGISTRY

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
  signal = null,
}: {
  initialSections: ResolvedHomeSection[]
  /** The app's read of how this person trains — passive, never rendered on
   *  home, and null when it reads nothing. */
  signal?: TrainingSignal | null
}) {
  const t = useTranslations('HomeLayoutEditor')
  const [sections, setSections] = useState<readonly ResolvedHomeSection[]>(initialSections)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
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

  function onShape(kind: string, size: HomeSectionShape) {
    const next = setSectionShape(sections, kind, size)
    if (next !== sections) persist(next)
  }

  /** Reset stores NULL — the read path's degrade-to-default IS the reset. The
   *  optimistic state must therefore be what an unsaved home RENDERS, which is
   *  the seeded layout and not the bare registry order: showing fifteen tiles
   *  here while home falls back to a six-tile preset would be the editor lying
   *  about the thing it is a miniature of. */
  function onReset() {
    setActiveId(null)
    persist(layoutForPreset(signal?.preset ?? null), { reset: true })
  }

  function onAdd(kind: string) {
    setGalleryOpen(false)
    const next = addSection(sections, kind)
    if (next !== sections) persist(next)
  }

  function onRemove(id: string) {
    setActiveId(null)
    const next = removeSection(sections, id)
    if (next !== sections) persist(next)
  }

  /** Applying a preset REPLACES the whole document — that is what makes it a
   *  shortcut rather than a merge with rules of its own. Any open sheet is
   *  closed first: it was showing a section whose shape and position have
   *  just changed underneath it. */
  function onApplyPreset(id: HomePresetId) {
    setActiveId(null)
    persist(applyPreset(id))
  }

  /**
   * What the gallery can offer. A once-only kind qualifies while it is
   * hidden; a REPEATABLE kind always qualifies, because adding another
   * instance is a different act from un-hiding the one you have.
   */
  const addable = REGISTRY.filter((meta) => {
    const present = sections.filter((s) => s.kind === meta.kind)
    if (meta.repeatable === true) return true
    return present.length === 0 || present[0].hidden
  }).map((meta) => ({
    meta,
    isAnother: meta.repeatable === true && sections.some((s) => s.kind === meta.kind && !s.hidden),
  }))

  const activeIndex = sections.findIndex((s) => s.id === activeId)
  const activeSection = activeIndex === -1 ? null : sections[activeIndex]
  const activeMeta =
    activeSection === null
      ? null
      : (HOME_SECTION_REGISTRY.find((s) => s.kind === activeSection.kind) ?? null)

  return (
    <>
      <PresetRow
        activePreset={matchPreset(sections)}
        signal={signal}
        onApply={onApplyPreset}
      />

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
          onOpen={setActiveId}
          onDragStart={dragController.onDragStart}
          onDragPreview={dragController.onDragPreview}
          onDragCommit={dragController.onDragCommit}
          onDragCancel={dragController.onDragCancel}
        />
      ) : (
        <EditorGrid sections={sections} onOpen={setActiveId} />
      )}

      <button
        type="button"
        onClick={() => setGalleryOpen(true)}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden"
      >
        <Plus aria-hidden="true" className="size-4" />
        {t('addAction')}
      </button>

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
          onClose={() => setActiveId(null)}
          onShape={(size) => onShape(activeSection.id, size)}
          onToggle={() => onToggle(activeSection.id)}
          onMove={(direction) => onMove(activeSection.id, direction)}
          onMoveToTop={() => onMoveToTop(activeSection.id)}
          onRemove={() => onRemove(activeSection.id)}
          /* An EXTRA instance is deleted rather than hidden — the sheet says
             so, because "Remove" and "Hide" are not the same promise. */
          removesPermanently={isExtraInstance(sections, activeSection.id)}
        />
      )}

      {galleryOpen && (
        <GallerySheet
          addable={addable}
          onAdd={onAdd}
          onClose={() => setGalleryOpen(false)}
        />
      )}
    </>
  )
}
