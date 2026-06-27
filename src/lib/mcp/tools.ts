import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { resolveUserId } from './resolve-user'

/**
 * Registers the Phase 1 MCP tools (ping, whoami) on the given server.
 *
 * Extracted from the route handler so the tool set and each tool's behavior are
 * unit-testable without standing up the Streamable HTTP `initialize` handshake.
 * Phase 1 exposes only connectivity/identity tools; the read and write tools land
 * in Phases 2 and 3 and will register here too.
 */
export function registerTools(server: McpServer): void {
  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description:
        'Liveness check — returns "pong". Use to confirm the MCP endpoint is reachable.',
      inputSchema: {},
    },
    async () => ({ content: [{ type: 'text', text: 'pong' }] }),
  )

  server.registerTool(
    'whoami',
    {
      title: 'Who Am I',
      description:
        'Returns the resolved target userId (the `userId` argument, else the MCP_DEV_USER_ID env default). Confirm this before any write.',
      inputSchema: { userId: z.string().optional() },
    },
    async ({ userId }) => {
      try {
        const resolved = resolveUserId(userId)
        return { content: [{ type: 'text', text: JSON.stringify({ userId: resolved }) }] }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to resolve userId'
        return { content: [{ type: 'text', text: message }], isError: true }
      }
    },
  )
}
