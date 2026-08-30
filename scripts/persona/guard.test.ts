import { describe, expect, it } from 'vitest'
import { assertLocalDatabase } from './guard'

describe('assertLocalDatabase', () => {
  it('passes for a localhost URL', () => {
    expect(() => assertLocalDatabase('postgres://u:p@localhost:6543/db', 'X')).not.toThrow()
  })

  it('passes for a 127.0.0.1 URL', () => {
    expect(() => assertLocalDatabase('postgres://u:p@127.0.0.1:6543/db', 'X')).not.toThrow()
  })

  it('passes for a host.docker.internal URL', () => {
    expect(() =>
      assertLocalDatabase('postgres://u:p@host.docker.internal:6543/db', 'X'),
    ).not.toThrow()
  })

  it('passes for a db URL', () => {
    expect(() => assertLocalDatabase('postgres://u:p@db:5432/db', 'X')).not.toThrow()
  })

  it('throws for a remote-looking URL, naming the host', () => {
    expect(() =>
      assertLocalDatabase('postgres://u:p@db.supabase.co:6543/db', 'PERSONA_ALLOW_REMOTE_DB'),
    ).toThrow(/db\.supabase\.co/)
  })

  it('passes for the same remote URL when the escape hatch is set', () => {
    process.env.PERSONA_ALLOW_REMOTE_DB = '1'
    try {
      expect(() =>
        assertLocalDatabase('postgres://u:p@db.supabase.co:6543/db', 'PERSONA_ALLOW_REMOTE_DB'),
      ).not.toThrow()
    } finally {
      delete process.env.PERSONA_ALLOW_REMOTE_DB
    }
  })

  it('throws for an empty string (fail closed)', () => {
    expect(() => assertLocalDatabase('', 'PERSONA_ALLOW_REMOTE_DB')).toThrow()
  })
})
