import { describe, it, expect } from 'vitest'
import { DEFAULT_COACH_MODEL, resolveCoachModel } from './model'

describe('resolveCoachModel', () => {
  it('returns null when no provider is configured', () => {
    expect(resolveCoachModel({})).toBeNull()
  })

  it('prefers OpenRouter when its key is present', () => {
    const config = resolveCoachModel({
      OPENROUTER_API_KEY: 'or-key',
      AI_GATEWAY_API_KEY: 'gw-key',
    })
    expect(config?.provider).toBe('openrouter')
    // A constructed SDK model object, not a bare gateway slug.
    expect(typeof config?.model).not.toBe('string')
  })

  it('falls back to the gateway slug when only the gateway is configured', () => {
    const byKey = resolveCoachModel({ AI_GATEWAY_API_KEY: 'gw-key' })
    expect(byKey?.provider).toBe('vercel-gateway')
    expect(byKey?.model).toBe(DEFAULT_COACH_MODEL)

    // OIDC on Vercel deployments needs no key at all.
    const byOidc = resolveCoachModel({ VERCEL_OIDC_TOKEN: 'oidc' })
    expect(byOidc?.provider).toBe('vercel-gateway')
  })

  it('COACH_PROVIDER forces a provider even when a higher-priority one is configured', () => {
    const config = resolveCoachModel({
      OPENROUTER_API_KEY: 'or-key',
      AI_GATEWAY_API_KEY: 'gw-key',
      COACH_PROVIDER: 'vercel-gateway',
    })
    expect(config?.provider).toBe('vercel-gateway')
  })

  it('a forced provider that is not configured resolves to null, never a silent fallback', () => {
    expect(
      resolveCoachModel({ AI_GATEWAY_API_KEY: 'gw-key', COACH_PROVIDER: 'openrouter' }),
    ).toBeNull()
  })

  it('COACH_MODEL overrides the slug for any provider', () => {
    const config = resolveCoachModel({
      AI_GATEWAY_API_KEY: 'gw-key',
      COACH_MODEL: 'anthropic/claude-haiku-4.5',
    })
    expect(config?.model).toBe('anthropic/claude-haiku-4.5')
  })

  it('ignores whitespace-only keys', () => {
    expect(resolveCoachModel({ OPENROUTER_API_KEY: '   ' })).toBeNull()
  })
})
