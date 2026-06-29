import { describe, it, expect } from 'vitest'
import { assertProgramIdShape } from './program-id'
import { ToolError } from './errors'

describe('assertProgramIdShape', () => {
  it('does not throw for a well-formed UUID', () => {
    // Arrange
    const id = '8c2f0cc9-1a2b-4c3d-8e4f-5a6b7c8d9e0f'

    // Act + Assert
    expect(() => assertProgramIdShape(id)).not.toThrow()
  })

  it('accepts an uppercase UUID', () => {
    // Act + Assert
    expect(() => assertProgramIdShape('8C2F0CC9-1A2B-4C3D-8E4F-5A6B7C8D9E0F')).not.toThrow()
  })

  it.each([
    ['arbitrary text', 'abc'],
    ['a truncated UUID', '8c2f0cc9'],
    ['an empty string', ''],
    ['a UUID with a wrong-length group', '8c2f0cc9-1a2b-4c3d-8e4f-5a6b7c8d9e0'],
  ])('throws a ToolError matching /not found/ for %s', (_label, id) => {
    // Act + Assert
    expect(() => assertProgramIdShape(id)).toThrow(ToolError)
    expect(() => assertProgramIdShape(id)).toThrow(/not found/)
  })
})
