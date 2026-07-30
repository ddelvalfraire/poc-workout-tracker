/**
 * Client-side push helpers (safe to import in Client Components — no server
 * deps). The VAPID public key ships base64url-encoded but
 * `pushManager.subscribe` wants raw bytes; this is the standard unpadded
 * base64url → Uint8Array conversion.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i)
  }
  return output
}
