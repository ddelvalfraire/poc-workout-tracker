import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * The app icons are static files derived from the masters in `design/icons`.
 *
 * They used to be drawn per request by route handlers under `src/app/icons`,
 * which made a missing icon impossible — the handler always returned an image.
 * Static files can go missing: a rename, a regeneration that skips a size, or
 * a `public/` cleanup would ship a 404 to a home screen or a tab bar, and
 * nothing else in the suite would notice. These tests tie every referenced
 * URL back to a file that exists at the declared size.
 */
const ROOT = process.cwd()

/** Everything that names an `/icons/...` URL: the head, the manifest, and the
 *  service worker (push notifications reuse the 192). */
const REFERRERS = ['src/app/layout.tsx', 'src/app/manifest.ts', 'src/app/sw.ts']

/** Declared size per file — a 192 that regenerates at 512 still loads, and
 *  still breaks installability, so the sizes are asserted rather than assumed. */
const EXPECTED_SIZES: Record<string, number> = {
  'icon-192.png': 192,
  'icon-512.png': 512,
  'icon-maskable-512.png': 512,
  'apple-touch-icon.png': 180,
  'icon-32.png': 32,
  'icon-dark-32.png': 32,
}

function referencedIcons(relativeSource: string): string[] {
  const src = readFileSync(join(ROOT, relativeSource), 'utf8')
  return [...src.matchAll(/['"](\/icons\/[^'"]+)['"]/g)].map((match) => match[1])
}

/** Width/height straight out of the PNG IHDR chunk — no image dependency. */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('app icons', () => {
  it('ships every icon the app references', () => {
    const referenced = REFERRERS.flatMap((source) =>
      referencedIcons(source).map((url) => ({ source, url })),
    )
    // Guard the guard: a regex that silently matches nothing would pass every
    // assertion below without checking a single file.
    expect(referenced.length).toBeGreaterThan(0)

    for (const { source, url } of referenced) {
      const path = join(ROOT, 'public', url.replace(/^\//, ''))
      expect(existsSync(path), `${source} references ${url}, which does not exist`).toBe(true)
    }
  })

  it('generates each icon at the size it is declared to be', () => {
    for (const [file, size] of Object.entries(EXPECTED_SIZES)) {
      const path = join(ROOT, 'public/icons', file)
      expect(existsSync(path), `${file} is missing`).toBe(true)
      expect(pngSize(path), `${file} must be ${size}x${size}`).toEqual({
        width: size,
        height: size,
      })
    }
  })

  it('offers a favicon for both colour schemes', () => {
    // The mark ships on a volt tile; against dark browser chrome that reads as
    // a lit square, so the dark variant has to be wired or the swap is lost.
    const layout = readFileSync(join(ROOT, 'src/app/layout.tsx'), 'utf8')
    expect(layout).toMatch(/media: "\(prefers-color-scheme: light\)"/)
    expect(layout).toMatch(/media: "\(prefers-color-scheme: dark\)"/)
  })

  it('keeps an untargeted favicon fallback', () => {
    // Bookmarks, crawlers and bare /favicon.ico hits never parse the document,
    // so they never see the themed <link> pair.
    expect(existsSync(join(ROOT, 'src/app/favicon.ico'))).toBe(true)
  })
})
