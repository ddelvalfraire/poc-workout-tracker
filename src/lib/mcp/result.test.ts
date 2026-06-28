import { describe, it, expect, vi } from 'vitest'
import { jsonResult, errorResult } from './result'
import { ToolError } from './errors'

describe('jsonResult', () => {
  it('wraps a value as JSON text with no isError flag', () => {
    // Arrange + Act
    const result = jsonResult({ a: 1 })

    // Assert
    expect(result.content[0]?.text).toBe('{"a":1}')
    expect('isError' in result).toBe(false)
  })
})

describe('errorResult', () => {
  it('surfaces a ToolError message to the client (user-facing)', () => {
    // Arrange + Act
    const result = errorResult(new ToolError('boom'))

    // Assert
    expect(result.content[0]?.text).toBe('boom')
    expect(result.isError).toBe(true)
  })

  it('genericizes and logs an unexpected (non-ToolError) error so internals do not leak', () => {
    // Arrange
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const internal = new Error('connection to db-secret-host failed')

    // Act
    const result = errorResult(internal)

    // Assert
    expect(result.content[0]?.text).toBe('MCP tool failed')
    expect(result.isError).toBe(true)
    expect(spy).toHaveBeenCalledWith('MCP tool error:', internal)
    spy.mockRestore()
  })

  it('genericizes and logs non-Error throwables', () => {
    // Arrange
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Act
    const result = errorResult('weird')

    // Assert
    expect(result.content[0]?.text).toBe('MCP tool failed')
    expect(result.isError).toBe(true)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
