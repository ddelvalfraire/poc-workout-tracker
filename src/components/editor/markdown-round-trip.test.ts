// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { notesExtensions } from './extensions'

/**
 * Markdown round-trip contract for the notes editor (headless @tiptap/core
 * with the SAME extension config the React component mounts): markdown
 * strings are the source of truth, so everything the editor can author must
 * survive markdown → doc → markdown unchanged. This is the guarantee that
 * lets agents (MCP) and the editor write the same column. The schema is one
 * config for both variants — a restricted schema would DROP unparseable
 * nodes on save (headings authored elsewhere would vanish in QuickCapture).
 */
function roundTrip(markdown: string): string {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: notesExtensions(),
    content: markdown,
    contentType: 'markdown',
  })
  try {
    return editor.getMarkdown()
  } finally {
    editor.destroy()
  }
}

describe('notes editor markdown round-trip', () => {
  it.each([
    ['plain text', 'Seat pin 4'],
    ['bold', 'Seat pin **4**'],
    ['italic', 'Warm up *slow*'],
    ['bullet list', '- pin 4\n- narrow grip'],
    ['ordered list', '1. pin 4\n2. narrow grip'],
    ['link', '[setup video](https://example.com/video)'],
    ['multi paragraph', 'Seat pin 4\n\nNarrow grip'],
    ['h2 heading', '## Setup'],
    ['h3 heading', '### Cues'],
    ['heading + prose', '## Setup\n\nSeat pin 4'],
  ])('%s survives the round-trip unchanged', (_name, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown)
  })

  it('nested marks round-trip inside list items', () => {
    const markdown = '- **pin 4** at *45°*'
    expect(roundTrip(markdown)).toBe(markdown)
  })
})
