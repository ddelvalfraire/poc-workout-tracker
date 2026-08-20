import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'

/**
 * The ONLY module that knows which LLM providers exist. The chat route asks
 * for "the coach model" and gets back an AI SDK LanguageModel — everything
 * vendor-specific (env keys, SDK construction, slugs) stays behind this seam,
 * so swapping or adding a provider is one PROVIDERS entry, zero route changes.
 *
 * Both current providers accept the same `vendor/model` slug format, so
 * COACH_MODEL stays provider-agnostic. Selection: first configured provider
 * in PROVIDERS order wins; COACH_PROVIDER (a provider id) forces one when
 * several are configured. Null when none is — the route 503s with SETUP_HINT.
 */

export const DEFAULT_COACH_MODEL = 'anthropic/claude-sonnet-4.5'

/**
 * Anthropic prompt caching, applied at the request root.
 *
 * The coach re-sends a large, byte-identical prefix on every turn: 44 MCP tool
 * schemas, then the system prompt. Anthropic caches in tools → system →
 * messages order, so that prefix is the whole win. Root-level `cache_control`
 * is OpenRouter's multi-turn mode — it puts the breakpoint on the last
 * cacheable block and ADVANCES it as the conversation grows, so settled
 * history joins the cache instead of being re-billed at full price.
 *
 * Reads cost 0.1x input. Writes cost 1.25x at the default 5-minute TTL, or 2x
 * at one hour — and one hour is the right trade HERE specifically. The coach
 * is used in a gym: ask, do a set, rest three minutes, ask again. A session
 * sprawls across an hour with gaps, and every gap past five minutes would
 * expire the cache and charge a fresh write — repeatedly paying 1.25x is worse
 * than paying 2x once. Pick the TTL from how the thing is actually used, not
 * from the default.
 *
 * Sent via extraBody rather than providerOptions.openrouter.cacheControl:
 * that typed path has an open report of not applying reliably
 * (OpenRouterTeam/ai-sdk-provider#35), and extraBody goes straight into the
 * request body where the API contract is unambiguous.
 */
const OPENROUTER_CACHE_CONTROL = { type: 'ephemeral', ttl: '1h' } as const

/** Operator-facing remedy for the "no provider configured" 503. */
export const COACH_MODEL_SETUP_HINT =
  'No AI provider configured. Set OPENROUTER_API_KEY or AI_GATEWAY_API_KEY.'

type Env = Record<string, string | undefined>

export interface CoachModelConfig {
  /** Which adapter produced the model — for logs/telemetry, never branching. */
  provider: string
  model: LanguageModel
}

interface CoachProviderAdapter {
  id: string
  isConfigured(env: Env): boolean
  create(slug: string, env: Env): LanguageModel
}

/** Priority order: prepaid OpenRouter credits before gateway billing. */
const PROVIDERS: readonly CoachProviderAdapter[] = [
  {
    id: 'openrouter',
    isConfigured: (env) => Boolean(env.OPENROUTER_API_KEY?.trim()),
    create: (slug, env) =>
      createOpenRouter({ apiKey: env.OPENROUTER_API_KEY!.trim() }).chat(slug, {
        extraBody: { cache_control: OPENROUTER_CACHE_CONTROL },
      }),
  },
  {
    id: 'vercel-gateway',
    // On Vercel deployments OIDC authenticates the gateway without a key.
    isConfigured: (env) => Boolean(env.AI_GATEWAY_API_KEY?.trim() || env.VERCEL_OIDC_TOKEN),
    // A bare slug string IS an AI SDK model when the gateway is the global
    // provider — no SDK object to build, and so no place to hang caching
    // config. The gateway path is the unused fallback (OpenRouter is first and
    // is what every environment configures); if it ever becomes primary, its
    // caching is `providerOptions.gateway.caching: 'auto'` at the call site.
    create: (slug) => slug,
  },
]

export function resolveCoachModel(env: Env = process.env): CoachModelConfig | null {
  const slug = env.COACH_MODEL?.trim() || DEFAULT_COACH_MODEL
  const forced = env.COACH_PROVIDER?.trim().toLowerCase()

  const candidates = forced ? PROVIDERS.filter((p) => p.id === forced) : PROVIDERS
  const provider = candidates.find((p) => p.isConfigured(env))
  if (!provider) return null
  return { provider: provider.id, model: provider.create(slug, env) }
}
