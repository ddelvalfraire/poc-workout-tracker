import { ToolError } from './errors'

/**
 * Shared shaping for MCP tool results.
 *
 * The `whoami`/`ping` tools hand-build the `{ content: [{ type:'text', text }] }`
 * envelope (and the `isError` variant) inline; the read tools repeat that five
 * times, so these helpers DRY it. `as const` pins the literal `type`/`isError`
 * so the shapes satisfy the SDK's `CallToolResult` content union.
 */

/** A successful MCP tool result carrying `value` as JSON text. */
export function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

/**
 * An MCP error result (isError). A user-facing `ToolError` message is surfaced
 * verbatim; any other (unexpected/internal) error is logged server-side and
 * replaced with a generic message so DB internals and stack details never reach
 * the client.
 */
export function errorResult(error: unknown) {
  if (error instanceof ToolError) {
    return { content: [{ type: 'text' as const, text: error.message }], isError: true as const }
  }
  console.error('MCP tool error:', error)
  return { content: [{ type: 'text' as const, text: 'MCP tool failed' }], isError: true as const }
}
