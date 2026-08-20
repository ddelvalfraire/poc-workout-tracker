'use client'

import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  type SortingStrategy,
} from '@dnd-kit/sortable'
import { HOME_SECTION_REGISTRY, type HomeSectionMeta } from '@/lib/home/registry'
import { useTranslations } from 'next-intl'
import type { ResolvedHomeSection } from '@/lib/home/layout'
import { cn } from '@/lib/utils'
import { SectionTile, TILE_SPAN } from './section-tile'
import type { EditorGridProps } from './editor-grid'

/**
 * The drag-enabled grid: the static EditorGrid's exact markup, wrapped in a
 * DndContext. Loaded lazily on this route only (the editor swaps it in after
 * hydration; the static grid is the no-JS/loading fallback) so dnd-kit never
 * touches any other bundle.
 *
 * Drag is an ENHANCEMENT: tap still opens the tile sheet, whose Move buttons
 * remain the guaranteed reorder path (WCAG 2.5.7). Long-press (250ms, 5px
 * tolerance) starts a drag; the sort strategy is a no-op and the preview is
 * the real thing — onDragOver reorders the editor's state, so the CSS grid
 * reflows live, spans and all, exactly as home would. Commit persists once
 * on drop; cancel restores the pre-drag snapshot.
 *
 * Keyboard: each tile wrapper is a sortable element (dnd-kit's built-in
 * instructions and announcements), separate from the inner edit button —
 * two stops, two clearly-announced verbs.
 */

/** Items never transform — the live state reorder IS the preview. */
const noOpStrategy: SortingStrategy = () => null

export interface DndGridProps extends EditorGridProps {
  onDragStart: () => void
  /** Live preview: move `activeKind` to `overKind`'s slot in editor state. */
  onDragPreview: (activeKind: string, overKind: string) => void
  /** Drop: persist the previewed order (once). */
  onDragCommit: () => void
  /** Escape/interruption: restore the pre-drag snapshot. */
  onDragCancel: () => void
}

export function DndGrid({
  sections,
  onOpen,
  onDragStart,
  onDragPreview,
  onDragCommit,
  onDragCancel,
}: DndGridProps) {
  const t = useTranslations('HomeSection')
  const [activeKind, setActiveKind] = useState<string | null>(null)
  const sensors = useSensors(
    // Long-press activation: 250ms hold, 5px slop — a scroll flick or a
    // quick tap never becomes a drag. PointerSensor alone covers mouse,
    // touch, and pen; registering TouchSensor alongside it risks
    // double-activation, so it stays out.
    useSensor(PointerSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragStart(event: DragStartEvent) {
    setActiveKind(String(event.active.id))
    onDragStart()
  }

  function handleDragOver(event: DragOverEvent) {
    const over = event.over
    if (over !== null && event.active.id !== over.id) {
      onDragPreview(String(event.active.id), String(over.id))
    }
  }

  const active = sections.find((s) => s.kind === activeKind)
  const activeMeta =
    active === undefined
      ? undefined
      : HOME_SECTION_REGISTRY.find((s) => s.kind === active.kind)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      // Items reflow mid-drag (that IS the preview), so droppable rects must
      // be re-measured continuously, not cached from drag start.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={() => {
        setActiveKind(null)
        onDragCommit()
      }}
      onDragCancel={() => {
        setActiveKind(null)
        onDragCancel()
      }}
    >
      <SortableContext items={sections.map((s) => s.kind)} strategy={noOpStrategy}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          {sections.map((section) => {
            const meta = HOME_SECTION_REGISTRY.find((s) => s.kind === section.kind)
            if (!meta) return null // unknown kind (future client): not editable here
            return (
              <SortableTile
                key={section.kind}
                section={section}
                meta={meta}
                onOpen={() => onOpen(section.kind)}
              />
            )
          })}
        </div>
      </SortableContext>
      {/* The lifted ghost: the same schematic tile, floating. The in-grid
          original dims to read as the drop slot. */}
      <DragOverlay>
        {active !== undefined && activeMeta !== undefined ? (
          <SectionTile
            title={t(activeMeta.titleKey)}
            size={active.size}
            hidden={active.hidden}
            onOpen={() => {}}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function SortableTile({
  section,
  meta,
  onOpen,
}: {
  section: ResolvedHomeSection
  meta: HomeSectionMeta
  onOpen: () => void
}) {
  const t = useTranslations('HomeSection')
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id: section.kind,
  })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        TILE_SPAN[section.size],
        'rounded-lg touch-manipulation outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        // The original stays in the grid as the drop slot while the
        // DragOverlay carries the visual.
        isDragging && 'opacity-30',
      )}
    >
      <SectionTile
        title={t(meta.titleKey)}
        size={section.size}
        hidden={section.hidden}
        onOpen={onOpen}
      />
    </div>
  )
}
