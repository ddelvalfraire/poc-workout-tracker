// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { installMemoryLocalStorage } from '../../vitest.storage'
import {
  DRAWER_PERSIST_PREFIX,
  clearPersistedDrawer,
  pruneForeignDrawerSnapshots,
} from './query-persister'

/** The persister's own key shape: prefix + '-' + the query hash, which is
 *  the JSON of the query key — so the user id sits in the key verbatim. */
const keyFor = (userId: string) => `${DRAWER_PERSIST_PREFIX}-${JSON.stringify(['drawer', userId])}`

beforeEach(() => {
  installMemoryLocalStorage()
})

describe('pruneForeignDrawerSnapshots', () => {
  it('removes other accounts’ snapshots and keeps this user’s', () => {
    window.localStorage.setItem(keyFor('user_1'), '{"mine":true}')
    window.localStorage.setItem(keyFor('user_2'), '{"theirs":true}')
    window.localStorage.setItem('unrelated', 'stays')

    pruneForeignDrawerSnapshots('user_1')

    expect(window.localStorage.getItem(keyFor('user_1'))).toBe('{"mine":true}')
    expect(window.localStorage.getItem(keyFor('user_2'))).toBeNull()
    expect(window.localStorage.getItem('unrelated')).toBe('stays')
  })

  it('does not treat a user id that is a prefix of another as a match', () => {
    // "user_1" is a substring of "user_10" — the JSON-quoted form is what
    // makes the check exact.
    window.localStorage.setItem(keyFor('user_10'), '{}')

    pruneForeignDrawerSnapshots('user_1')

    expect(window.localStorage.getItem(keyFor('user_10'))).toBeNull()
  })
})

describe('clearPersistedDrawer', () => {
  it('removes every drawer snapshot and nothing else', () => {
    window.localStorage.setItem(keyFor('user_1'), '{}')
    window.localStorage.setItem(keyFor('user_2'), '{}')
    window.localStorage.setItem('unrelated', 'stays')

    clearPersistedDrawer()

    expect(window.localStorage.getItem(keyFor('user_1'))).toBeNull()
    expect(window.localStorage.getItem(keyFor('user_2'))).toBeNull()
    expect(window.localStorage.getItem('unrelated')).toBe('stays')
  })
})
