import { createMcpHandler } from 'mcp-handler'
import { registerTools } from '@/lib/mcp/tools'

/**
 * MCP server for the workout tracker, exposed as an in-app Streamable HTTP
 * endpoint at /api/mcp (the [transport] segment resolves to "mcp"). PUBLIC and
 * UNAUTHENTICATED by design — a POC agent surface; see the MCP PRD. The Clerk
 * middleware (src/proxy.ts) exempts /api/mcp so this handler runs headless.
 *
 * Tool registration lives in @/lib/mcp/tools (registerTools) so it is unit-testable
 * without the Streamable HTTP handshake. Phase 1 registers only connectivity/identity
 * tools (ping, whoami); the read and write tools land in Phases 2 and 3.
 */
const handler = createMcpHandler(
  registerTools,
  {
    // Identifies this server to connecting MCP clients (shown in their UI).
    serverInfo: { name: 'workout-tracker', version: '0.1.0' },
  },
  {
    // basePath must match where the [transport] segment lives so the client URL
    // is exactly /api/mcp. Streamable HTTP only — no redisUrl (Redis is SSE-only).
    basePath: '/api',
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV !== 'production',
  },
)

export { handler as GET, handler as POST }
