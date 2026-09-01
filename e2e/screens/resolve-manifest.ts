import { listWorkoutSummaries } from '@/db/workouts'
import { listPrograms } from '@/db/programs'
import { getActiveShare } from '@/db/program-shares'
import { getActiveWorkoutShare } from '@/db/workout-shares'
import { listLoggedExercises } from '@/db/exercise-stats'
import { readManifest } from '../../scripts/persona/manifest'

/**
 * The routing-relevant subset of `PersonaManifest` — identity plus the entity
 * ids the route manifest's param routes need. Two ways to arrive at one:
 * `--persona <slug>` reads it straight from `e2e/.state/<slug>.json`;
 * `--user <email>` re-derives it live from the database on a best-effort
 * basis (see `resolveRuntimeManifest`). `persona`/`seed`/`anchor` are dropped
 * — they carry no routing information.
 */
export interface ResolvedManifest {
  userId: string
  email: string
  workoutId?: string
  programId?: string
  templateId?: string
  exerciseRef?: string
  programShareToken?: string | null
  workoutShareToken?: string | null
}

const EMULATOR_ORIGIN = process.env.WORKOS_E2E_API_BASE ?? 'http://localhost:4100'
const EMULATOR_API_KEY = 'sk_test_default'
const WORKOS_API = `${EMULATOR_ORIGIN}/user_management`
const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal|db)(:\d+)?\/?$/

function assertLocalEmulator(origin: string): void {
  if (LOCAL_ORIGIN_PATTERN.test(origin)) return
  throw new Error(
    `Refusing to look up a screens-rig target user against a non-local WorkOS origin (${origin}).\n` +
      'WORKOS_E2E_API_BASE must point at the local `workos emulate` server.',
  )
}

interface EmulatorUser {
  id: string
  email: string
}

function readUsers(body: unknown): EmulatorUser[] {
  const root = body as { data?: unknown[] } | unknown[]
  const list = Array.isArray(root) ? root : Array.isArray((root as { data?: unknown[] })?.data) ? (root as { data: unknown[] }).data : []
  return list
    .map((entry) => entry as { id?: unknown; email?: unknown })
    .filter((entry): entry is EmulatorUser => typeof entry.id === 'string' && typeof entry.email === 'string')
}

/**
 * Looks up the emulator user id for an email. Tries the `?email=` filter
 * first; falls back to an unfiltered list + client-side match if the
 * emulator ignores or rejects the param.
 */
async function findUserIdByEmail(email: string): Promise<string> {
  assertLocalEmulator(EMULATOR_ORIGIN)

  const filtered = await fetch(`${WORKOS_API}/users?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${EMULATOR_API_KEY}` },
  }).catch(() => null)
  if (filtered?.ok) {
    const match = readUsers(await filtered.json()).find((u) => u.email === email)
    if (match) return match.id
  }

  const unfiltered = await fetch(`${WORKOS_API}/users`, {
    headers: { Authorization: `Bearer ${EMULATOR_API_KEY}` },
  })
  if (!unfiltered.ok) {
    throw new Error(`WorkOS list users failed (${unfiltered.status})`)
  }
  const match = readUsers(await unfiltered.json()).find((u) => u.email === email)
  if (!match) {
    throw new Error(`no emulator user found for email "${email}" — sign up or seed this user first`)
  }
  return match.id
}

/** Re-derives a `ResolvedManifest` live from the database for `--user` mode.
 *  Any field that can't be resolved (empty list, no active share) stays
 *  `undefined`/`null` — never throws for a missing optional field. */
async function resolveRuntimeManifest(email: string): Promise<ResolvedManifest> {
  const userId = await findUserIdByEmail(email)

  const [workouts, programs, loggedExercises] = await Promise.all([
    listWorkoutSummaries(userId),
    listPrograms(userId),
    listLoggedExercises(userId),
  ])

  const workoutId = workouts[0]?.id
  const program = programs[0]
  const programId = program?.id
  const loggedExercise = loggedExercises[0]
  const exerciseRef = loggedExercise ? `${loggedExercise.source}:${loggedExercise.wgerExerciseId}` : undefined

  const [programShare, workoutShare] = await Promise.all([
    programId ? getActiveShare(userId, programId) : Promise.resolve(null),
    workoutId ? getActiveWorkoutShare(userId, workoutId) : Promise.resolve(null),
  ])

  console.log(
    '[screens] --user mode cannot resolve templateId; /templates/[id] and /programs/templates/[id] will be skipped',
  )

  return {
    userId,
    email,
    workoutId,
    programId,
    templateId: undefined,
    exerciseRef,
    programShareToken: programShare?.token ?? null,
    workoutShareToken: workoutShare?.token ?? null,
  }
}

export async function resolveManifest(slug: string): Promise<ResolvedManifest> {
  if (slug === 'user') {
    const email = process.env.SCREENS_TARGET_USER
    if (!email) throw new Error('SCREENS_TARGET_USER is not set — the "user" project requires it')
    return resolveRuntimeManifest(email)
  }
  const manifest = await readManifest(slug)
  if (!manifest) {
    throw new Error(`no manifest for persona "${slug}" — run \`npm run persona -- --persona ${slug}\` first`)
  }
  return manifest
}
