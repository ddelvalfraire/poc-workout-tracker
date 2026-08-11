import { describe, it, expect } from 'vitest'
import { diffMigrations } from './migration-guard'

// Synthetic whens (epoch ms) — the guard compares drizzle's apply-order
// timestamps, the same key drizzle-kit migrate itself uses.
const journal = [
  { tag: '0000_init', when: 1000 },
  { tag: '0001_add_sets', when: 2000 },
  { tag: '0002_diet_phase', when: 3000 },
]

describe('diffMigrations', () => {
  it('reports in-sync when the DB applied every journal migration', () => {
    expect(diffMigrations(journal, [1000, 2000, 3000])).toEqual({
      ok: true,
      pending: [],
      dbAhead: false,
    })
  })

  it('lists the pending migration the DB has not applied (the 0041 outage shape)', () => {
    const result = diffMigrations(journal, [1000, 2000])
    expect(result.ok).toBe(false)
    expect(result.pending).toEqual(['0002_diet_phase'])
  })

  it('lists every pending migration in journal order', () => {
    expect(diffMigrations(journal, [1000]).pending).toEqual(['0001_add_sets', '0002_diet_phase'])
  })

  it('tolerates orphan applied rows older than the frontier (edited-after-apply history)', () => {
    // A historical row whose file was later regenerated keeps its created_at;
    // drizzle ignores it and so must the guard.
    const result = diffMigrations(journal, [1000, 1500, 2000, 3000])
    expect(result).toEqual({ ok: true, pending: [], dbAhead: false })
  })

  it('fails when the DB is AHEAD of this checkout (deploying would ship old code)', () => {
    const result = diffMigrations(journal, [1000, 2000, 3000, 4000])
    expect(result.ok).toBe(false)
    expect(result.dbAhead).toBe(true)
    expect(result.pending).toEqual([])
  })

  it('handles the empty DB (fresh database, everything pending)', () => {
    const result = diffMigrations(journal, [])
    expect(result.ok).toBe(false)
    expect(result.pending).toEqual(['0000_init', '0001_add_sets', '0002_diet_phase'])
  })
})
