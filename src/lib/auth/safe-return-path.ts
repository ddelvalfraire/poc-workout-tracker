/**
 * Narrows a caller-supplied `redirect_url` to a path we are willing to send a
 * freshly-signed-in user to.
 *
 * The share pages link to `/sign-in?redirect_url=/p/<token>` so the visitor
 * lands back on the thing they came for. That query value is attacker-
 * controllable, and handing it to the auth provider unchecked is an open
 * redirect: `/sign-in?redirect_url=https://evil.example` would bounce a user
 * who just authenticated straight off-site — exactly the moment they are most
 * likely to trust what they see.
 *
 * So: same-site absolute paths only. Anything else degrades to the home page
 * rather than throwing, because a malformed link should still sign you in.
 */
export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw) return '/'
  // Exactly one leading slash. `//evil.example` is protocol-relative and
  // resolves OFF-SITE; several browsers treat `/\evil.example` the same way.
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  // A backslash anywhere invites browser-specific host/path confusion, and no
  // legitimate route in this app contains one.
  if (raw.includes('\\')) return '/'
  // Control characters can split a header downstream.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return '/'
  return raw
}
