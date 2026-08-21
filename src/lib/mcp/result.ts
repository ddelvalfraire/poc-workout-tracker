import { ToolError } from './errors'
import { FeatureRequiredError } from '@/db/entitlements'

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
  // Entitlement refusals are user-facing by design — the error's own contract
  // is that the catching surface "has to name the plan that says yes" — so
  // they surface verbatim wherever a db-layer gate throws one, instead of
  // being genericized into an unactionable "MCP tool failed".
  if (error instanceof FeatureRequiredError) {
    return { content: [{ type: 'text' as const, text: error.message }], isError: true as const }
  }
  console.error('MCP tool error:', error)
  return { content: [{ type: 'text' as const, text: 'MCP tool failed' }], isError: true as const }
}
