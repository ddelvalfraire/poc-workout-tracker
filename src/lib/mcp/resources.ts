import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { resolveUserId } from './resolve-user'
import { ToolError } from './errors'
import { buildWorkoutPayload } from './read-tools'
import { getWorkoutDetail } from '@/db/workouts'
import { getWeightUnit } from '@/db/preferences'

/**
 * Registers read-only MCP resources — the addressable, URI-referenced surface of
 * the agent server.
 *
 * `workout://{id}` is the resource twin of the `get_workout` tool: it returns the
 * exact same payload (via the shared `buildWorkoutPayload`), just fetched by URI
 * instead of a tool call. A resource URI carries no `userId`, so the user is the
 * env default (`MCP_DEV_USER_ID`) resolved through `resolveUserId`.
 *
 * Resources have no `isError` envelope, so the read callback signals failure by
 * *throwing*. We mirror the tools' leak-safe split: a `ToolError` (not-found, no
 * user) propagates verbatim because its message is meant for the caller; any
 * other (internal/DB) error is logged server-side and replaced with a generic
 * message so internals never cross the wire.
 */
export function registerResources(server: McpServer): void {
  server.registerResource(
    'workout',
    new ResourceTemplate('workout://{id}', { list: undefined }),
    {
      title: 'Workout',
      description:
        "A single workout (env-default user) with its exercises, sets in the user's unit, and a per-exercise estimated 1RM. Same shape as the get_workout tool.",
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      // URI template variables arrive as string | string[]; `{id}` is single.
      const id = Array.isArray(variables.id) ? variables.id[0] : variables.id
      try {
        if (!id) throw new ToolError('workout id is required')
        const resolved = resolveUserId() // no arg → MCP_DEV_USER_ID
        const workout = await getWorkoutDetail(resolved, id)
        if (!workout) {
          throw new ToolError(`Workout ${id} not found for user ${resolved}`)
        }
        const unit = await getWeightUnit(resolved)
        const payload = buildWorkoutPayload(workout, resolved, unit)
        return {
          contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(payload) }],
        }
      } catch (error: unknown) {
        if (error instanceof ToolError) throw error // actionable message, safe to surface
        console.error('MCP resource error:', error)
        throw new Error('MCP resource read failed') // genericize internals
      }
    },
  )
}
