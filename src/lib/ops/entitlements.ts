import 'server-only'
import { getWorkOS } from '@workos-inc/authkit-nextjs'
import { getEntitlement, listGrants, listPaidUsers, type EntitlementGrant } from '@/db/entitlements'
import type { ResolvedEntitlement, Tier, GrantSource } from '@/lib/entitlements/tiers'
import type { OpsResult } from './types'

/**
 * Reads behind /ops/billing. Two questions an operator actually has:
 * "what does THIS person have, and why" (lookup) and "who is paying at all"
 * (roster).
 *
 * Every WorkOS call here is a SECRET-KEY call with no ownership check of its
 * own — the same IDOR discipline as src/lib/workos/account.ts, except the
 * whole point of this surface is looking up somebody else. That is why the
 * page and every action re-assert `isOpsUser` rather than trusting the route.
 *
 * Soft-fails into OpsResult like the rest of /ops: WorkOS being down must
 * degrade this panel, not blank the board.
 */

export interface OpsUser {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  createdAt: string
}

export interface BillingSnapshot {
  user: OpsUser
  effective: ResolvedEntitlement
  grants: EntitlementGrant[]
  /** When the snapshot was taken (epoch ms). The ledger dates its rows
   *  against THIS, not a second clock read at render time: the "as of" of a
   *  snapshot belongs to the snapshot, and reading the clock while rendering
   *  makes the render impure (and, on a server component, uncacheable). */
  asOfMs: number
}

/**
 * Ceiling on directory paging while resolving emails. Ten pages is 1,000 users
 * — far past where this panel stops being the right tool, and a hard stop so a
 * paging bug can never turn one render into an unbounded crawl.
 */
const MAX_DIRECTORY_PAGES = 10

export interface PaidUserRow {
  userId: string
  email: string | null
  tier: Tier
  source: GrantSource | null
  expiresAt: Date | null
  updatedAt: Date
}

/** WorkOS user ids are prefixed; anything else is treated as an email. */
function looksLikeUserId(query: string): boolean {
  return query.startsWith('user_')
}

function toOpsUser(user: {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  createdAt: string
}): OpsUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    createdAt: user.createdAt,
  }
}

/**
 * Finds one user by id or email. Email is the field support actually has —
 * nobody arrives with a `user_01...` — but the id path matters because a
 * deleted-then-recreated account shares the email and not the id.
 *
 * Returns `null` for "no such user", which is a real answer and not a
 * failure; only a broken call becomes an OpsResult error.
 */
export async function lookupUser(query: string): Promise<OpsResult<OpsUser | null>> {
  const trimmed = query.trim()
  if (!trimmed) return { ok: true, data: null }

  try {
    const workos = getWorkOS()
    if (looksLikeUserId(trimmed)) {
      const user = await workos.userManagement.getUser(trimmed)
      return { ok: true, data: toOpsUser(user) }
    }
    const page = await workos.userManagement.listUsers({ email: trimmed, limit: 1 })
    const user = page.data[0]
    return { ok: true, data: user ? toOpsUser(user) : null }
  } catch {
    // A 404 for an id that does not exist is indistinguishable here from a
    // real outage, and both answer the operator's question the same way:
    // nothing to show. Reporting it as unavailable is the honest read —
    // "not found" would assert more than we know.
    return { ok: false, reason: 'unavailable' }
  }
}

/** The full picture for one user: who they are, what they have, and why. */
export async function getBillingSnapshot(
  query: string,
): Promise<OpsResult<BillingSnapshot | null>> {
  const found = await lookupUser(query)
  if (!found.ok) return found
  if (!found.data) return { ok: true, data: null }

  const user = found.data
  try {
    const [effective, grants] = await Promise.all([getEntitlement(user.id), listGrants(user.id)])
    return { ok: true, data: { user, effective, grants, asOfMs: Date.now() } }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/**
 * Everyone currently on a paid tier, with emails resolved in a bounded batch
 * rather than per row — a roster of 100 users must not become 100 round-trips
 * to WorkOS on every render of an always-dynamic page.
 *
 * A row whose email cannot be resolved still appears, with a null email: the
 * entitlement is the fact this surface is about, and hiding a paying user
 * because their directory lookup failed would be the wrong silence.
 */
export async function getPaidRoster(): Promise<OpsResult<PaidUserRow[]>> {
  let rows: Awaited<ReturnType<typeof listPaidUsers>>
  try {
    rows = await listPaidUsers()
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
  if (rows.length === 0) return { ok: true, data: [] }

  const emails = await resolveEmails(rows.map((r) => r.userId))
  return {
    ok: true,
    data: rows.map((r) => ({ ...r, email: emails.get(r.userId) ?? null })),
  }
}

async function resolveEmails(userIds: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  const wanted = new Set(userIds)

  try {
    const workos = getWorkOS()
    // listUsers has no id-set filter and caps a page at 100, so page until
    // every wanted id is found. The bound matters: without it a directory that
    // grew past one page would silently render paying members as raw ids —
    // a defect that gets WORSE as the business grows, which is exactly when
    // nobody is looking at this panel closely.
    let after: string | undefined
    for (let page = 0; page < MAX_DIRECTORY_PAGES && found.size < wanted.size; page += 1) {
      const result = await workos.userManagement.listUsers({ limit: 100, after })
      for (const user of result.data) {
        if (wanted.has(user.id)) found.set(user.id, user.email)
      }
      after = result.listMetadata.after ?? undefined
      if (!after) break
    }
  } catch {
    // Emails are decoration here; the entitlement rows are the answer.
  }
  return found
}
