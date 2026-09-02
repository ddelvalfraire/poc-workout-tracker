import {
  experimental_createQueryPersister,
  type PersistedQuery,
} from '@tanstack/query-persist-client-core'
import { isDrawerData } from '@/lib/home/drawer-status'

/**
 * Per-query persistence for the nav drawer's status snapshot (the ONE query
 * that must survive an app launch): iOS evicts the installed PWA and the
 * update-on-resume probe hard-reloads, and both used to put ghost rows in
 * front of the first hamburger tap. TanStack's per-query persister keeps
 * the last snapshot in localStorage and restores it lazily on the query's
 * first use; a snapshot older than staleTime revalidates in the background
 * while the restored rows stay rendered.
 *
 * Chosen over PersistQueryClientProvider deliberately: that persists the
 * WHOLE client (every future query, whether or not its data belongs on
 * disk) and gates first render on restore. Here exactly one query opts in.
 *
 * Privacy contract (docs/legal/privacy-policy.md §5): the snapshot is the
 * user's own training summary on their own device, keyed by user id, never
 * older than a day, and removed on sign-out and account deletion. A second
 * account on the same device never sees the first one's rows — see
 * pruneForeignDrawerSnapshots.
 */

export const DRAWER_PERSIST_PREFIX = 'wt-drawer'

/** A launch-to-launch cache, not a database: yesterday's rows are good
 *  enough to open on, older ones are not. */
export const DRAWER_PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** localStorage, or undefined where it does not exist (the server render)
 *  or throws (Safari private mode, storage disabled). Every caller must
 *  render correctly without it. */
function browserStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/**
 * The persister's storage, resolved at CALL time rather than captured at
 * module load (this module is evaluated during the server render too, and
 * in jsdom before a storage exists), and fail-soft: a full or disabled
 * store (quota, private mode) makes persistence a no-op, never an error in
 * the query path. The persister itself does not guard setItem.
 */
const lazyBrowserStorage = {
  getItem(key: string): string | null {
    try {
      return browserStorage()?.getItem(key) ?? null
    } catch {
      return null
    }
  },
  setItem(key: string, value: string): void {
    try {
      browserStorage()?.setItem(key, value)
    } catch {
      // Quota exceeded / storage disabled: the next launch is a cold one.
    }
  },
  removeItem(key: string): void {
    try {
      browserStorage()?.removeItem(key)
    } catch {
      // Nothing to remove, or nowhere to remove it from.
    }
  },
}

/**
 * The persister's entry envelope: `{ state: { data, ... }, queryKey, queryHash,
 * buster }`. Deserialize validates the DATA's shape and throws on a miss —
 * the persister treats a throwing deserialize as a corrupt entry (removes
 * it, restores nothing), which is exactly the cold open we want for a
 * snapshot written by an older DrawerData shape. The buster covers
 * deploys; this covers everything the buster cannot (a long-lived dev
 * server, a hand-edited entry).
 */
function deserializeDrawerSnapshot(raw: string): PersistedQuery {
  const parsed: unknown = JSON.parse(raw)
  const data =
    typeof parsed === 'object' && parsed !== null && 'state' in parsed
      ? (parsed as { state?: { data?: unknown } }).state?.data
      : undefined
  if (!isDrawerData(data)) throw new Error('persisted drawer snapshot has a stale shape')
  return parsed as PersistedQuery
}

export const drawerPersister = experimental_createQueryPersister({
  storage: lazyBrowserStorage,
  maxAge: DRAWER_PERSIST_MAX_AGE_MS,
  prefix: DRAWER_PERSIST_PREFIX,
  deserialize: deserializeDrawerSnapshot,
  // A deploy may change the payload shape; the build id busts every entry
  // written by the previous build (one cold open per deploy, never a crash
  // on a stale shape).
  buster: process.env.NEXT_PUBLIC_BUILD_ID ?? '',
})

function persistedDrawerKeys(storage: Storage): string[] {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (key !== null && key.startsWith(`${DRAWER_PERSIST_PREFIX}-`)) keys.push(key)
  }
  return keys
}

/** Sign-out / account deletion: nothing of the user's stays on the device. */
export function clearPersistedDrawer(): void {
  const storage = browserStorage()
  if (storage === undefined) return
  for (const key of persistedDrawerKeys(storage)) storage.removeItem(key)
}

/**
 * Drop every drawer snapshot that is not THIS user's. The persister keys
 * entries by query hash, and the drawer's key is ['drawer', userId], so the
 * user id appears verbatim (JSON-quoted) in the storage key: a session that
 * expired without a sign-out, followed by another account signing in on the
 * same device, must never restore the previous account's rows.
 */
export function pruneForeignDrawerSnapshots(userId: string): void {
  const storage = browserStorage()
  if (storage === undefined) return
  const mine = JSON.stringify(userId)
  for (const key of persistedDrawerKeys(storage)) {
    if (!key.includes(mine)) storage.removeItem(key)
  }
}
