/**
 * Renders a `ToolCallDescription` into the one-line summary the approval card
 * and the proposal diff show.
 *
 * It is separate from describe-tool-call.ts on purpose: that module decides,
 * this one speaks, and only this one needs a translator. Everything it joins
 * with is punctuation — ", " between location pieces and changes, " — " before
 * the scope, ": " after the location, " · " between meta facts — so no
 * sentence is ever assembled out of separately translated words.
 */

import { renderLine, renderLines, type Translator } from '@/lib/i18n/message'
import { humanizeToolName } from './chat-ui'
import type { ToolCallDescription, ToolCallKey } from './describe-tool-call'

/** Capitalizes the first character (locations render sentence-initially). */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function renderToolCall(
  t: Translator<ToolCallKey>,
  description: ToolCallDescription,
): string {
  const { scope, location, changes, detail, meta, toolName } = description
  // Nothing survived validation (or the tool is unknown): the humanized
  // protocol identifier is the never-blank fallback.
  if (changes.length === 0) return humanizeToolName(toolName)

  const head = [
    scope !== null ? renderLine(t, scope) : null,
    location.length > 0 ? renderLines(t, location, ', ') : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' — ')

  let body = renderLines(t, changes, ', ')
  if (detail.length > 0) body += ` (${renderLines(t, detail, ', ')})`

  const line = head ? `${sentence(head)}: ${body}` : sentence(body)
  return meta.length > 0 ? `${line} · ${renderLines(t, meta)}` : line
}
