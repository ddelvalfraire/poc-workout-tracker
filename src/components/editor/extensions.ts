import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import type { Extensions } from '@tiptap/core'

/**
 * The ONE extension config both editor variants share (and the round-trip
 * test exercises headlessly). Markdown strings are the source of truth —
 * `Markdown` gives the editor bidirectional markdown (contentType at init,
 * `editor.getMarkdown()` on save); editor JSON is never persisted.
 *
 * The SCHEMA is deliberately identical for both variants — the variant only
 * changes the toolbar (quick: bold/italic/lists/links; full: + h2/h3). A
 * variant-restricted schema would silently DROP nodes it can't parse on the
 * next save (verified by the round-trip test), and any stored markdown —
 * agent-authored included — must survive either editor unchanged.
 */
export type NotesEditorVariant = 'quick' | 'full'

export function notesExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      // Off everywhere: notes and descriptions are prose, not documents.
      codeBlock: false,
      blockquote: false,
      horizontalRule: false,
      // Never navigate mid-edit; markdown output is unaffected.
      link: { openOnClick: false },
    }),
    Markdown,
  ]
}
