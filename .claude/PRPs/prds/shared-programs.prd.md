# Shared Programs — visibility model + share links (tier 1 of the social ladder)

## Problem Statement

Programs are articles with proposals, attribution, and clone machinery — but
no way to reach another account. Tier 1 ships share links on top of a REAL
visibility model so tiers 2–3 (crews, group programs, human coaches) extend
data, not schema. Direct user ask (2026-08-02): "We can start on tier 1 but
sharing should be extensible. Might also be a good opportunity to enable
public private or shared programs?"

## Visibility model

`programs.visibility` text NOT NULL DEFAULT 'private':
- **private** — today's behavior, byte-identical. The default forever.
- **link** ("shared") — anyone holding a share URL can view read-only.
- **public** — link behavior PLUS eligibility for a future browse/directory
  surface (the field is the seam; no directory ships in tier 1).

Threading mirrors the planSync/checkInEveryDays discipline exactly:
optional in input schemas with NO materialized default, preserve-on-omit on
update, explicit value writes through, clone does NOT carry visibility (a
clone is a new private thing — deliberate divergence from metadata carry),
MCP upsert/get expose it with the preservation note. Proposals can never be
set sharable and a 'proposed' program's links never resolve (the forced
confirm gates cross-account artifacts INTO an account; visibility gates
content OUT — a pending proposal is neither).

## Share links

`program_shares`: id uuid pk, programId FK cascade, token text UNIQUE
(cryptographically random, 24+ chars), createdAt, revokedAt nullable.
Separate table, not a column — rotation, multiple live links, and future
rows carrying scope (crewId, expiresAt) without schema surgery.

- Owner UI on the program page: visibility selector (Private / Shared via
  link / Public), copy-link, revoke-and-rotate. Revoke sets revokedAt; a
  new share mints a new token.
- Resolution: /p/[token] (Clerk-public route, self-gating): token → live
  share (revokedAt null) → program with visibility link|public and status
  != 'proposed' → render; anything else 404s without acknowledging
  existence (the ops-gate idiom).

## The public page (/p/[token])

Read-only article: hero/icon/title/description, full day → exercise → set
structure via the existing program-rendering pieces, "Shared by" line, wger
attribution when sourceUrl exists. NEVER: owner's history, stats, body
data, change-log. Signed-in visitor (non-owner): "Add to my programs" →
cloneProgram into THEIR account as status 'proposed' with authorActor =
owner's userId (the value space doing its job) → the existing Adopt/Decline
banner is the forced confirm. Owner visiting their own link: a "this is
your program" note, no adopt. Signed-out: full read + sign-in CTA (the
acquisition surface; post-signin returns to the page).

## Security posture

- Token entropy ≥ 128 bits; constant-shape 404s (no revoked-vs-never
  distinction); page is read-only and cheap (RSC, short cache ok).
- Cross-account adopt re-validates server-side: share live, visibility
  still link|public, source not proposed — at CLONE time, not render time.
- Rate limiting: reuse the existing public-route posture; the page carries
  no user data worth scraping beyond the program content itself.

## What We're NOT Building (tier 1)

Crews/membership, feeds, accountability grids, human-coach roles, the
public directory (visibility 'public' is accepted + stored, the browse
surface comes with tier 2+), share analytics/view counts, body-data sharing
(hard rule: never crosses accounts in any tier).

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Private stays private | visibility default + no resolution path for private/proposed | route + db tests |
| Cross-account adopt | Link → sign in → proposal in the visitor's account attributed to the sharer → Adopt works | integration-style tests + manual two-account dogfood |
| Revocation | Revoked token 404s immediately; rotation mints a working replacement | tests |
| Extensible | Tier 2 needs new ROWS (scope columns), not new tables/rearchitecture | design review |

## Open Questions

- [ ] Post-adopt attribution display: "Proposed by <sharer name>" needs a
  display-name lookup (Clerk) — v1 may show "Shared program" if name
  plumbing is heavy; decide in build.
