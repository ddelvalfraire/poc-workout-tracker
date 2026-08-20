'use client'

import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { Bold, Italic, Link2, List, ListOrdered } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { notesExtensions, type NotesEditorVariant } from './extensions'
import { useTranslations } from 'next-intl'

/**
 * The ONE rich-text editor, two variants (plan §7): `quick` (QuickCapture —
 * bold/italic/lists/links) and `full` (FullEditor — same marks + h2/h3
 * headings). The variant changes ONLY the toolbar; the schema is shared so no
 * variant can drop content another surface authored (see extensions.ts).
 *
 * Markdown in, markdown out: `initialMarkdown` seeds the doc, every update
 * reports `editor.getMarkdown()` — editor JSON never leaves this component.
 * The toolbar sits BELOW the content (Notion's mobile fallback: a fixed bar
 * above the keyboard beats slash menus fighting predictive text).
 *
 * Always load this component through next/dynamic (see the consuming
 * surfaces) — TipTap must never ride a first-paint bundle.
 */
interface NotesEditorProps {
  variant: NotesEditorVariant
  initialMarkdown: string
  onChangeMarkdown: (markdown: string) => void
  ariaLabel: string
  autofocus?: boolean
}

/** One toolbar control: pressed styling mirrors the icon quick-pick idiom. */
function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      aria-pressed={active}
      className={cn('text-muted-foreground', active && 'bg-primary/15 text-primary')}
      // pointerdown preventDefault keeps the editor focused (and the keyboard
      // up) through the tap — the stepper-row trick from the logger.
      onPointerDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

export function NotesEditor({
  variant,
  initialMarkdown,
  onChangeMarkdown,
  ariaLabel,
  autofocus = false,
}: NotesEditorProps) {
  const t = useTranslations('NotesEditor')
  const editor = useEditor({
    extensions: notesExtensions(),
    content: initialMarkdown,
    contentType: 'markdown',
    autofocus: autofocus ? 'end' : false,
    // Client-only mount (the TipTap SSR rule): the component is always behind
    // next/dynamic anyway, but this kills the hydration-mismatch class cold.
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChangeMarkdown(editor.getMarkdown()),
    editorProps: {
      attributes: {
        // A bare contenteditable div has the generic role, which prohibits
        // aria-label — the name was being dropped by assistive tech, not just
        // flagged. role=textbox + aria-multiline is what MDN specifies for an
        // editable multi-line region, and what ProseMirror emits by default.
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': ariaLabel,
        class: cn(
          'notes-editor-content min-h-24 max-h-[45dvh] overflow-y-auto px-1 py-2 text-sm leading-relaxed outline-none',
          variant === 'full' && 'min-h-36',
        ),
      },
    },
  })

  // Selector-scoped subscription: the toolbar re-renders on active-state
  // changes only, not on every keystroke transaction.
  const active = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive('bold'),
            italic: editor.isActive('italic'),
            bulletList: editor.isActive('bulletList'),
            orderedList: editor.isActive('orderedList'),
            link: editor.isActive('link'),
            h2: editor.isActive('heading', { level: 2 }),
            h3: editor.isActive('heading', { level: 3 }),
          }
        : null,
  })

  function setLink() {
    if (!editor) return
    const existing = editor.getAttributes('link').href as string | undefined
    // window.prompt is deliberate: a one-field URL ask doesn't earn a second
    // sheet, and it can't collide with the dialog vocabulary mid-edit.
    const url = window.prompt(t('linkPrompt'), existing ?? 'https://')
    if (url === null) return
    const trimmed = url.trim()
    if (trimmed === '' || trimmed === 'https://') {
      editor.chain().focus().unsetLink().run()
      return
    }
    // http(s) only — the markdown renderer enforces the same allowlist.
    if (!/^https?:\/\//i.test(trimmed)) return
    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
  }

  return (
    <div className="rounded-lg border border-border bg-background/40">
      <EditorContent editor={editor} />
      {/* Toolbar below the content: on a phone this rides directly above the
          keyboard, where marks are reachable without covering the text. */}
      <div
        role="toolbar"
        aria-label={t('toolbarLabel')}
        className="flex items-center gap-1 border-t border-border px-1 py-0.5"
      >
        <ToolbarButton
          label={t('boldLabel')}
          active={active?.bold ?? false}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold aria-hidden="true" className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={t('italicLabel')}
          active={active?.italic ?? false}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic aria-hidden="true" className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={t('bulletListLabel')}
          active={active?.bulletList ?? false}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List aria-hidden="true" className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={t('numberedListLabel')}
          active={active?.orderedList ?? false}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered aria-hidden="true" className="size-4" />
        </ToolbarButton>
        <ToolbarButton label={t('linkLabel')} active={active?.link ?? false} onClick={setLink}>
          <Link2 aria-hidden="true" className="size-4" />
        </ToolbarButton>
        {variant === 'full' && (
          <>
            <ToolbarButton
              label={t('headingLabel')}
              active={active?.h2 ?? false}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              <span aria-hidden="true" className="text-xs font-bold">
                {t('headingAbbr')}
              </span>
            </ToolbarButton>
            <ToolbarButton
              label={t('subheadingLabel')}
              active={active?.h3 ?? false}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
            >
              <span aria-hidden="true" className="text-xs font-bold">
                {t('subheadingAbbr')}
              </span>
            </ToolbarButton>
          </>
        )}
      </div>
    </div>
  )
}
