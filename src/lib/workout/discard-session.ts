/**
 * The one way a session gets discarded, shared by the logger's Discard button
 * and the session-conflict dialog — dependency-injected so the destructive
 * ordering is unit-tested without component infrastructure.
 *
 * Ordering contract:
 * 1. `settle` (when the surface has an autosave queue): pause + drain any
 *    in-flight draft PUT so nothing can re-create the draft after we delete.
 * 2. One delete, keyed by surface:
 *    - 'new' (quick log): only a draft exists — delete it.
 *    - workout id (program/edit session): delete the WORKOUT — its server
 *      action also clears the draft keyed by that id in the same call, so a
 *      separate draft round-trip would be redundant and would split one
 *      user-visible operation into two failure points.
 * Failures propagate to the caller, which owns error copy and queue resume.
 */
export interface DiscardSessionDeps {
  deleteDraft: (key: string) => Promise<void>
  deleteWorkout: (id: string) => Promise<void>
  /** The logger's save-time barrier; surfaces without an autosave queue omit it. */
  settle?: () => Promise<void>
}

export async function discardSession(key: string, deps: DiscardSessionDeps): Promise<void> {
  await deps.settle?.()
  if (key === 'new') {
    await deps.deleteDraft(key)
  } else {
    await deps.deleteWorkout(key)
  }
}
