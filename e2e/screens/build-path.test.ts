import { describe, expect, it } from 'vitest'
import { buildPath, type RouteParam } from './build-path'
import type { ResolvedManifest } from './resolve-manifest'

const BASE: ResolvedManifest = { userId: 'u', email: 'e' }

describe('buildPath', () => {
  it('substitutes a resolved param', () => {
    const params: RouteParam[] = [{ name: 'programId', source: 'programId' }]
    const resolved: ResolvedManifest = { ...BASE, programId: 'abc' }

    expect(buildPath('/programs/:programId', params, resolved)).toEqual({
      path: '/programs/abc',
      missing: [],
    })
  })

  it('reports a missing param instead of substituting', () => {
    const params: RouteParam[] = [{ name: 'programId', source: 'programId' }]

    expect(buildPath('/programs/:programId', params, BASE)).toEqual({
      path: '/programs/:programId',
      missing: ['programId'],
    })
  })

  it('substitutes a literal param alongside a resolved one', () => {
    const params: RouteParam[] = [
      { name: 'programId', source: 'programId' },
      { name: 'day', source: 'literal', literal: '1' },
    ]
    const resolved: ResolvedManifest = { ...BASE, programId: 'abc' }

    expect(buildPath('/programs/:programId/editor/:day', params, resolved)).toEqual({
      path: '/programs/abc/editor/1',
      missing: [],
    })
  })

  it('returns the template unchanged for a static route with no params', () => {
    expect(buildPath('/settings', [], BASE)).toEqual({ path: '/settings', missing: [] })
  })

  it('splits a composite field into separate path segments', () => {
    const params: RouteParam[] = [
      { name: 'exerciseSource', source: 'exerciseRef', split: { on: ':', index: 0 } },
      { name: 'exerciseId', source: 'exerciseRef', split: { on: ':', index: 1 } },
    ]
    const resolved: ResolvedManifest = { ...BASE, exerciseRef: 'wger:345' }

    expect(buildPath('/exercises/:exerciseSource/:exerciseId', params, resolved)).toEqual({
      path: '/exercises/wger/345',
      missing: [],
    })
  })
})
