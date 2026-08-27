import { EditorSurface } from './editor-surface'

/**
 * The editor addressed at no day — the structure-only view.
 *
 * On phone this IS the editor's page: the week and day lists fill the column
 * and a day row navigates to `./[day]`. At or above the pane breakpoint the
 * same route renders all three panes with pane 2 showing its empty canvas.
 * The projection is CSS in `EditorPanes`; this file only supplies the address.
 */
export default async function ProgramEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ week?: string | string[]; exercise?: string | string[] }>
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  return <EditorSurface programId={id} searchParams={sp} />
}
