import {
  authServerMetadataHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from '@clerk/mcp-tools/next'

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414), proxied from Clerk.
 *
 * After reading the protected-resource metadata, an MCP client fetches this to
 * learn the authorize/token/registration endpoints for the Clerk dev instance,
 * then runs the OAuth + Dynamic Client Registration handshake. Public +
 * CORS-enabled, like the protected-resource document.
 */
const handler = authServerMetadataHandlerClerk()

const corsHandler = metadataCorsOptionsRequestHandler()

export { handler as GET, corsHandler as OPTIONS }
