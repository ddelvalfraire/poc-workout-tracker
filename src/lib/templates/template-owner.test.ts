import { describe, it, expect } from 'vitest'
import { TEMPLATE_OWNER_USER_ID } from './template-owner'

describe('TEMPLATE_OWNER_USER_ID', () => {
  it('can never collide with a real WorkOS account (WorkOS ids always start with user_)', () => {
    // The collision-safety claim the constant's comment makes, pinned: if
    // this id ever starts with `user_`, a real account could own the
    // template library and adoption/authz assumptions break silently.
    expect(TEMPLATE_OWNER_USER_ID).not.toMatch(/^user_/)
  })
})
