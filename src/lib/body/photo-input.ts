/**
 * Shared vocabulary for progress photos — pose whitelist, size/count caps,
 * ThumbHash encoding helpers, and the magic-byte MIME sniffer. Isomorphic on
 * purpose: the browser pipeline and the upload route must agree on every one
 * of these constants, so they live in one file both sides import.
 */

import type { Message } from '../message'

export const PHOTO_POSES = ['front', 'side', 'back'] as const
export type PhotoPose = (typeof PHOTO_POSES)[number]

export function isPhotoPose(value: string): value is PhotoPose {
  return (PHOTO_POSES as readonly string[]).includes(value)
}

/**
 * The catalog key for a pose's human label, in the `Body` namespace.
 *
 * Title-casing the stored enum value only ever produced English, and the
 * value itself is a database fact that must never be written in the creating
 * user's language. So the label is a descriptor: the pose whitelist stays
 * here, the words live in `Body.pose.*`, and the four photo surfaces that
 * render it share one vocabulary — the same pose reading differently on the
 * cell and in the overlay would be a bug, not a translation choice.
 */
export function photoPoseLabel(pose: PhotoPose): Message<`pose.${PhotoPose}`> {
  return { key: `pose.${pose}` }
}

export const PHOTO_NOTE_MAX_LENGTH = 500

// Mirrors the bucket's own 10MB object limit — the client rejects pre-upload
// with a clear message instead of letting Storage 413 opaquely.
export const MAX_DISPLAY_BYTES = 10 * 1024 * 1024
// A 320px webp thumb is tens of KB; 2MB already means something went wrong.
export const MAX_THUMB_BYTES = 2 * 1024 * 1024

// Per-user stored-photo cap (spike open question, resolved at 200) — the
// blob-spend guard, enforced server-side at upload.
export const PHOTO_CAP = 200

// A ThumbHash is ~25 bytes; the band rejects garbage without being brittle
// about the exact encoder output length.
const THUMBHASH_MIN_BYTES = 5
const THUMBHASH_MAX_BYTES = 64

/** Base64-encodes raw bytes (isomorphic — btoa exists in browsers and Node). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Decodes base64 back to bytes; throws on malformed input (atob does). */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** True when the string decodes to a plausibly-sized ThumbHash. */
export function isValidThumbHash(value: string): boolean {
  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(value)
  } catch {
    return false
  }
  return bytes.length >= THUMBHASH_MIN_BYTES && bytes.length <= THUMBHASH_MAX_BYTES
}

export type SniffedImageType = 'image/webp' | 'image/jpeg' | 'image/png' | 'image/heic'

// HEIC/HEIF ftyp brands (ISO BMFF box at offset 4). The bucket whitelists
// heic, so the sniffer must recognize it even though the pipeline never
// emits it.
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'heif', 'mif1', 'msf1']

/**
 * Identifies an image by magic bytes — never by extension or the client's
 * declared Content-Type, both attacker-controlled. Returns null for anything
 * outside the bucket's whitelist (webp/jpeg/png/heic).
 */
export function sniffImageContentType(bytes: Uint8Array): SniffedImageType | null {
  if (bytes.length < 12) return null
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes[0] === 0x89 &&
    ascii(1, 4) === 'PNG' &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (ascii(4, 8) === 'ftyp' && HEIC_BRANDS.includes(ascii(8, 12))) return 'image/heic'
  return null
}
