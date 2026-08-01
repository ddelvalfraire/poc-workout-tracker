import { requireEnv } from './env'

/**
 * Server-only Supabase Storage client for the private `progress-photos`
 * bucket, via plain REST fetch — no @supabase/supabase-js dependency: three
 * endpoints don't justify an SDK in the server bundle, and the new-style
 * sb_secret key works directly as both the Authorization bearer and the
 * apikey header against storage/v1. The bucket is private (public=false);
 * clients only ever see the signed, expiring URLs minted here. The server
 * never transforms images — it stores what the browser pipeline sends (the
 * deliberate E2EE escape hatch).
 */

export const PHOTO_BUCKET = 'progress-photos'

/** Signed URLs outlive a render + a slow scroll, not a share. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60

function storageBaseUrl(): string {
  return `${requireEnv('SUPABASE_URL')}/storage/v1`
}

function authHeaders(): Record<string, string> {
  const key = requireEnv('SUPABASE_SECRET_KEY')
  return { Authorization: `Bearer ${key}`, apikey: key }
}

/** Uploads one object; throws (status + body excerpt) on any non-2xx. */
export async function uploadObject(
  key: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<void> {
  const res = await fetch(`${storageBaseUrl()}/object/${PHOTO_BUCKET}/${key}`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': contentType,
      // Never overwrite: keys embed a fresh uuid, so a collision is a bug.
      'x-upsert': 'false',
    },
    body,
  })
  if (!res.ok) {
    throw new Error(`storage upload failed (${res.status}): ${await safeBodyExcerpt(res)}`)
  }
}

/**
 * Removes objects by key. Throws on transport/API failure — callers decide
 * whether that is fatal (upload rollback) or best-effort (post-delete sweep).
 */
export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  const res = await fetch(`${storageBaseUrl()}/object/${PHOTO_BUCKET}`, {
    method: 'DELETE',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: keys }),
  })
  if (!res.ok) {
    throw new Error(`storage delete failed (${res.status}): ${await safeBodyExcerpt(res)}`)
  }
}

/**
 * Bulk-signs object keys in ONE request (the timeline signs every thumb +
 * display at render — per-key requests would be hundreds of round-trips).
 * Returns key → absolute URL; keys the API errored on are simply absent, so
 * callers degrade to the ThumbHash placeholder instead of a broken image.
 */
export async function createSignedUrls(
  keys: string[],
  expiresInSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<Map<string, string>> {
  const signed = new Map<string, string>()
  if (keys.length === 0) return signed
  const base = storageBaseUrl()
  const res = await fetch(`${base}/object/sign/${PHOTO_BUCKET}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: expiresInSeconds, paths: keys }),
  })
  if (!res.ok) {
    throw new Error(`storage sign failed (${res.status}): ${await safeBodyExcerpt(res)}`)
  }
  const items = (await res.json()) as Array<{
    path: string | null
    signedURL: string | null
    error: string | null
  }>
  for (const item of items) {
    // signedURL comes back relative to storage/v1 ("/object/sign/…?token=…").
    if (item.path && item.signedURL && !item.error) {
      signed.set(item.path, `${base}${item.signedURL}`)
    }
  }
  return signed
}

/** First bytes of an error body, for diagnosable messages without dumping payloads. */
async function safeBodyExcerpt(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200)
  } catch {
    return '<unreadable body>'
  }
}
