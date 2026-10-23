import { DEFAULT_LANGFUSE_BASE_URL, DEFAULT_WGER_API_BASE_URL } from './constants'

/**
 * Node runtime helpers, shared by Next.js and the standalone migration tools.
 * Keep reads lazy: dotenv loads after imports in the CLI, and storage/ops
 * callers must observe the current environment. Browser consumers import
 * public defaults from ./constants instead of importing environment readers.
 */

/** Reads a required variable without exposing its value in failure messages. */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

/** Resolves the shared exercise/template host, preserving the existing nullish fallback. */
export function wgerApiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return env.WGER_API_BASE_URL ?? DEFAULT_WGER_API_BASE_URL
}

/** Resolves the ops API host; an empty setting uses Cloud and one trailing slash is removed. */
export function langfuseApiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.LANGFUSE_BASEURL || DEFAULT_LANGFUSE_BASE_URL).replace(/\/$/, '')
}
