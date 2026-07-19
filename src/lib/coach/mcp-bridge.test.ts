import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createCoachMcpClient } from './mcp-bridge'
import { filterCoachTools } from './tool-policy'

function firstText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: unknown; text?: unknown }> }).content
  const part = content?.[0]
  if (!part || part.type !== 'text' || typeof part.text !== 'string') {
    throw new Error('expected a text content part')
  }
  return part.text
}

describe('createCoachMcpClient', () => {
  const original = process.env.MCP_DEV_USER_ID
  beforeEach(() => {
    delete process.env.MCP_DEV_USER_ID
  })
  afterEach(() => {
    if (original === undefined) delete process.env.MCP_DEV_USER_ID
    else process.env.MCP_DEV_USER_ID = original
  })

  it('injects the authenticated userId as authInfo so tools resolve it', async () => {
    // Arrange
    const client = await createCoachMcpClient('user_bridge_test')

    try {
      // Act — whoami surfaces exactly what resolveUserId decided.
      const result = await client.callTool({ name: 'whoami' })

      // Assert
      expect(JSON.parse(firstText(result))).toEqual({ userId: 'user_bridge_test' })
    } finally {
      await client.close()
    }
  })

  it('outranks a model-supplied userId argument (no impersonation)', async () => {
    // Arrange
    const client = await createCoachMcpClient('user_bridge_test')

    try {
      // Act
      const result = await client.callTool({
        name: 'whoami',
        arguments: { userId: 'user_attacker' },
      })

      // Assert — authInfo wins over the argument, per resolveUserId precedence.
      expect(JSON.parse(firstText(result))).toEqual({ userId: 'user_bridge_test' })
    } finally {
      await client.close()
    }
  })

  it('exposes the registry as AI SDK tools that survive the coach policy filter', async () => {
    // Arrange
    const client = await createCoachMcpClient('user_bridge_test')

    try {
      // Act
      const tools = filterCoachTools(await client.tools())

      // Assert — smoke: reads + drafting present, excluded writes absent.
      expect(tools).toHaveProperty('list_workouts')
      expect(tools).toHaveProperty('add_program_set')
      // Phase 2: upsert_program is coach-drafting now — the db layer forces
      // coach creates to proposed/coach-authored, so it survives the filter.
      expect(tools).toHaveProperty('upsert_program')
      expect(tools).not.toHaveProperty('delete_program')
      expect(tools).not.toHaveProperty('delete_workout')
    } finally {
      await client.close()
    }
  })
})
