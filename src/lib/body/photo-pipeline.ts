import { rgbaToThumbHash, thumbHashToDataURL } from 'thumbhash'
import { base64ToBytes, bytesToBase64, MAX_DISPLAY_BYTES } from './photo-input'

/**
 * Browser-side image pipeline: File → canvas resize → webp derivatives +
 * ThumbHash, all BEFORE upload. The server never transforms images — it only
 * stores what it receives. That split is deliberate: it is the E2EE escape
 * hatch (a future client could encrypt these same derivatives before upload
 * with zero server changes), even though E2EE itself is not being built now —
 * per the user: "I guess it's not worth doing now. because pwas are flaky,
 * and dont always work as expected."
 *
 * EXIF strategy: the canvas re-encode IS the strip. Drawing to a canvas and
 * re-encoding discards every metadata block — GPS, timestamps, device — so
 * nothing sensitive ever leaves the device. createImageBitmap honors the
 * EXIF orientation flag by default, so the pixels land upright too.
 */

/** Long-edge cap for the compare/detail rendition. */
export const DISPLAY_MAX_EDGE = 1080
/** Long-edge cap for the timeline-grid rendition. */
export const THUMB_MAX_EDGE = 320
// ThumbHash requires both edges ≤ 100px; encode from a tiny downscale.
const THUMBHASH_MAX_EDGE = 100

export const DISPLAY_QUALITY = 0.82
export const THUMB_QUALITY = 0.75

export interface PreparedPhoto {
  display: Blob
  thumb: Blob
  /** Base64 ThumbHash (~25 bytes) — stored on the row, decoded for placeholders. */
  thumbHash: string
}

/** Scaled dimensions fitting inside maxEdge — aspect kept, never upscaled, min 1px. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height)
  if (longEdge <= maxEdge) return { width, height }
  const scale = maxEdge / longEdge
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Runs the full pipeline on a picked file. Throws with user-facing messages
 * on oversize or undecodable input; the caller surfaces them verbatim.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (file.size > MAX_DISPLAY_BYTES) {
    throw new Error('That photo is over 10 MB. Pick a smaller one.')
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('That file doesn’t look like a photo this browser can read.')
  }
  try {
    const [display, thumb] = await Promise.all([
      encodeScaled(bitmap, DISPLAY_MAX_EDGE, DISPLAY_QUALITY),
      encodeScaled(bitmap, THUMB_MAX_EDGE, THUMB_QUALITY),
    ])
    return { display, thumb, thumbHash: encodeThumbHash(bitmap) }
  } finally {
    bitmap.close()
  }
}

/**
 * Decodes a stored ThumbHash to a tiny data-URL image for instant
 * placeholders. Returns null on malformed input — a missing blur is fine,
 * a crashed timeline is not.
 */
export function thumbHashToPlaceholderUrl(thumbHash: string): string | null {
  try {
    return thumbHashToDataURL(base64ToBytes(thumbHash))
  } catch {
    return null
  }
}

/** Draws the bitmap into a fresh canvas at the fitted size. */
function drawScaled(
  bitmap: ImageBitmap,
  maxEdge: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Couldn’t process the photo on this device.')
  ctx.drawImage(bitmap, 0, 0, width, height)
  return { canvas, ctx }
}

/**
 * Resize + re-encode. Requests webp; browsers without a webp encoder (older
 * Safari) silently emit png — the upload route sniffs actual bytes and
 * accepts both, so the fallback is fine end-to-end.
 */
function encodeScaled(bitmap: ImageBitmap, maxEdge: number, quality: number): Promise<Blob> {
  const { canvas } = drawScaled(bitmap, maxEdge)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob !== null
          ? resolve(blob)
          : reject(new Error('Couldn’t process the photo on this device.')),
      'image/webp',
      quality,
    )
  })
}

/** ThumbHash from a ≤100px downscale, base64 for the text column. */
function encodeThumbHash(bitmap: ImageBitmap): string {
  const { canvas, ctx } = drawScaled(bitmap, THUMBHASH_MAX_EDGE)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return bytesToBase64(rgbaToThumbHash(canvas.width, canvas.height, data))
}
