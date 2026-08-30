import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteManifest, readManifest, writeManifest, type PersonaManifest } from './manifest'

const SLUG = `test-${Math.random().toString(36).slice(2)}`

describe('manifest', () => {
  afterEach(async () => {
    await deleteManifest(SLUG)
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('round-trips a written manifest', async () => {
    const manifest: PersonaManifest = {
      persona: SLUG,
      userId: 'user_test',
      email: `persona_${SLUG}@example.com`,
      seed: 42,
      anchor: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    }
    await writeManifest(SLUG, manifest)
    const read = await readManifest(SLUG)
    expect(read).toEqual(manifest)
  })

  it('returns null for a slug that was never written', async () => {
    const read = await readManifest(`missing-${SLUG}`)
    expect(read).toBeNull()
  })

  it('propagates a non-ENOENT filesystem error', async () => {
    vi.resetModules()
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      return {
        ...actual,
        readFile: vi.fn().mockRejectedValue(Object.assign(new Error('boom'), { code: 'EACCES' })),
      }
    })
    const { readManifest: readManifestMocked } = await import('./manifest')
    await expect(readManifestMocked(SLUG)).rejects.toThrow('boom')
  })
})
