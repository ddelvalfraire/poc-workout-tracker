import { EditorSurface } from '../editor-surface'

/**
 * The editor addressed at one day.
 *
 * The day is a PATH SEGMENT because it is a place you can be — on phone this is
 * a page you navigated to, and Back returns to the structure list. At or above
 * the pane breakpoint the very same address instead lights up pane 2 beside the
 * list, which is why this file hands its segment to the same `EditorSurface`
 * the parent route uses rather than rendering a second, wider editor.
 *
 * An out-of-range or junk segment is not a 404: `resolveEditorAddress` returns
 * "no day" for it, and the surface falls back to the structure view — the
 * honest answer for a stale or shared link to a day that has since been
 * deleted.
 */
export default async function ProgramEditorDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; day: string }>
  searchParams: Promise<{ week?: string | string[]; exercise?: string | string[] }>
}) {
  const [{ id, day }, sp] = await Promise.all([params, searchParams])
  return <EditorSurface programId={id} daySegment={day} searchParams={sp} />
}
