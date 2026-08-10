import { reorderSection, type ResolvedHomeSection } from '@/lib/home/layout'

/**
 * The drag lifecycle's state logic, extracted from the editor so the
 * persistence contract is testable without mounting dnd-kit (whose sensors
 * need a real DOM the node test environment doesn't have). The editor wires
 * these four handlers to DndGrid VERBATIM — this module IS the behavior,
 * not a parallel copy.
 *
 * The contract under test:
 * - preview reorders state live and NEVER persists (a drag is one edit, not
 *   one per pointer move);
 * - commit persists exactly once, with the pre-DRAG order as the rollback
 *   target (a failed write must undo the whole drag, not just its last
 *   preview step);
 * - cancel restores the pre-drag snapshot without persisting;
 * - a commit with nothing moved (or without a start) is a no-op.
 */

export interface DragControllerDeps {
  /** Latest sections state (the editor reads through a ref — previews during
   *  the same drag must see each other). */
  getSections: () => readonly ResolvedHomeSection[]
  /** State-only update (the preview and the cancel restore). */
  setSections: (next: readonly ResolvedHomeSection[]) => void
  /** The editor's optimistic persist — rollbackTo is the failure target. */
  persist: (
    next: readonly ResolvedHomeSection[],
    opts: { rollbackTo: readonly ResolvedHomeSection[] },
  ) => void
}

export interface DragController {
  onDragStart: () => void
  onDragPreview: (activeKind: string, overKind: string) => void
  onDragCommit: () => void
  onDragCancel: () => void
}

export function createDragController(deps: DragControllerDeps): DragController {
  /** Order at drag start — rollback target for cancel and failed persists. */
  let snapshot: readonly ResolvedHomeSection[] | null = null

  return {
    onDragStart() {
      snapshot = deps.getSections()
    },
    onDragPreview(activeKind, overKind) {
      // Preview only — the grid reflows live; nothing persists until drop.
      const current = deps.getSections()
      const next = reorderSection(current, activeKind, overKind)
      if (next !== current) deps.setSections(next)
    },
    onDragCommit() {
      const start = snapshot
      snapshot = null
      if (start === null) return
      const current = deps.getSections()
      const unchanged =
        start.length === current.length && start.every((s, i) => s.kind === current[i].kind)
      if (unchanged) return
      deps.persist(current, { rollbackTo: start })
    },
    onDragCancel() {
      const start = snapshot
      snapshot = null
      if (start !== null) deps.setSections(start)
    },
  }
}
