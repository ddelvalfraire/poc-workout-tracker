import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Per-persona state file, read by later phases (screens rig, clone-to-local)
 * to resolve a persona's identity and key entity ids without re-deriving
 * them. Shape matches docs/specs/personas-and-screens.md's manifest example.
 */
export interface PersonaManifest {
  persona: string
  userId: string
  email: string
  seed: number
  anchor: string // ISO-8601 UTC
  workoutId?: string
  programId?: string
  templateId?: string
  exerciseRef?: string
  programShareToken?: string | null
  workoutShareToken?: string | null
}

const STATE_DIR = join(process.cwd(), 'e2e', '.state')

export async function writeManifest(slug: string, manifest: PersonaManifest): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true })
  await writeFile(join(STATE_DIR, `${slug}.json`), JSON.stringify(manifest, null, 2) + '\n')
}

export async function readManifest(slug: string): Promise<PersonaManifest | null> {
  try {
    return JSON.parse(await readFile(join(STATE_DIR, `${slug}.json`), 'utf8')) as PersonaManifest
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function deleteManifest(slug: string): Promise<void> {
  await rm(join(STATE_DIR, `${slug}.json`), { force: true })
}
