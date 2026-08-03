/**
 * Pure logic behind the share-card button — extracted so the capability
 * branches are unit-testable in the node test environment (the repo doesn't
 * run client components under jsdom). The component injects the real
 * `navigator`; tests inject shaped fakes.
 */

/** The slice of Navigator the share flow reads. */
export interface ShareNavigatorLike {
  share?: (data: { files?: File[]; title?: string }) => Promise<void>
  canShare?: (data: { files?: File[] }) => boolean
}

export type ShareStrategy = 'share' | 'download'

/**
 * File sharing needs BOTH `share()` and a `canShare()` that accepts the file
 * — the iOS PWA path. Anything less (desktop browsers, canShare rejecting
 * PNGs, a throwing canShare) falls back to download-with-hint.
 */
export function pickShareStrategy(
  nav: ShareNavigatorLike | undefined | null,
  file: File,
): ShareStrategy {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') {
    return 'download'
  }
  try {
    return nav.canShare({ files: [file] }) ? 'share' : 'download'
  } catch {
    return 'download'
  }
}

/** Share-sheet filename for a card: "315 Squat Club" → "315-squat-club.png". */
export function cardFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug !== '' ? slug : 'share-card'}.png`
}
