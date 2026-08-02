import type { ExerciseCategory, ExerciseSource } from '@/lib/custom-exercise-input'

/**
 * Exercise-name matching — the hard part of import. Pipeline, per the PRD:
 *   1. normalize (lowercase, extract parenthetical equipment qualifiers,
 *      collapse whitespace/punctuation)
 *   2. exact/normalized match against the merged catalog (wger + customs)
 *   3. curated alias table for top Strong/Hevy naming patterns
 *   4. unmatched → create a custom exercise (verbatim name) so no performed
 *      set is ever dropped
 * Pure: the caller supplies the catalog; nothing here touches the network/db.
 */

/** One merged-catalog entry the matcher can resolve to. */
export interface CatalogEntry {
  source: ExerciseSource
  id: number
  name: string
}

export type ExerciseResolution =
  | { kind: 'match'; source: ExerciseSource; id: number; name: string }
  | { kind: 'create' }

/** Abuse guard: an import may auto-create at most this many customs. */
export const MAX_CUSTOM_CREATES = 100

/** Lowercases, strips punctuation to spaces, collapses whitespace. */
function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Candidate normalized keys for an import name, most specific first:
 *  - full string flattened ("bench press barbell")
 *  - parenthetical qualifiers moved to the FRONT ("barbell bench press") —
 *    Strong/Hevy write "Movement (Equipment)", catalogs write the reverse
 *  - base name without qualifiers ("bench press"), last: it's the loosest
 */
export function candidateKeys(name: string): string[] {
  const keys: string[] = []
  const push = (key: string) => {
    if (key !== '' && !keys.includes(key)) keys.push(key)
  }

  push(normalizeKey(name))

  const qualifiers: string[] = []
  const base = name
    .replace(/\(([^)]*)\)/g, (_, inner: string) => {
      qualifiers.push(inner)
      return ' '
    })
    .trim()
  if (qualifiers.length > 0) {
    push(normalizeKey(`${qualifiers.join(' ')} ${base}`))
    push(normalizeKey(base))
  }

  return keys
}

/**
 * Curated Strong/Hevy → catalog-name aliases, keyed by normalized import
 * name. Values are CATALOG names — resolved against the live merged catalog
 * at match time, so a stale alias degrades to auto-create, never to a wrong
 * match. A tested pure map, grown over time.
 */
export const EXERCISE_ALIASES: Readonly<Record<string, string>> = {
  // Presses
  'bench press barbell': 'Bench Press',
  'bench press dumbbell': 'Dumbbell Bench Press',
  'incline bench press barbell': 'Incline Bench Press',
  'incline bench press dumbbell': 'Incline Dumbbell Bench Press',
  'overhead press barbell': 'Overhead Press',
  'overhead press dumbbell': 'Dumbbell Shoulder Press',
  'shoulder press dumbbell': 'Dumbbell Shoulder Press',
  'strict military press barbell': 'Overhead Press',
  'seated shoulder press dumbbell': 'Dumbbell Shoulder Press',
  'chest press machine': 'Machine Chest Press',
  // Squats / legs
  'squat barbell': 'Squat',
  'back squat': 'Squat',
  'front squat barbell': 'Front Squat',
  'leg press machine': 'Leg Press',
  'leg extension machine': 'Leg Extension',
  'leg curl machine': 'Leg Curl',
  'seated leg curl machine': 'Leg Curl',
  'lying leg curl machine': 'Leg Curl',
  'bulgarian split squat dumbbell': 'Bulgarian Split Squat',
  'lunge dumbbell': 'Dumbbell Lunge',
  'calf raise standing': 'Standing Calf Raise',
  'standing calf raise machine': 'Standing Calf Raise',
  'seated calf raise machine': 'Seated Calf Raise',
  // Hinges / pulls
  'deadlift barbell': 'Deadlift',
  'romanian deadlift barbell': 'Romanian Deadlift',
  'stiff leg deadlift barbell': 'Stiff-Leg Deadlift',
  'sumo deadlift barbell': 'Sumo Deadlift',
  'hip thrust barbell': 'Hip Thrust',
  'bent over row barbell': 'Bent Over Row',
  'row barbell': 'Bent Over Row',
  'seated row cable': 'Seated Cable Row',
  'seated cable row cable': 'Seated Cable Row',
  'lat pulldown cable': 'Lat Pulldown',
  'lat pulldown machine': 'Lat Pulldown',
  'pull up': 'Pull-up',
  'pull up assisted': 'Assisted Pull-up',
  'chin up': 'Chin-up',
  'face pull cable': 'Face Pull',
  // Arms / shoulders
  'bicep curl barbell': 'Barbell Curl',
  'bicep curl dumbbell': 'Dumbbell Curl',
  'hammer curl dumbbell': 'Hammer Curl',
  'preacher curl barbell': 'Preacher Curl',
  'triceps pushdown cable': 'Triceps Pushdown',
  'tricep pushdown cable straight bar': 'Triceps Pushdown',
  'skullcrusher barbell': 'Skull Crusher',
  'lateral raise dumbbell': 'Lateral Raise',
  'side lateral raise dumbbell': 'Lateral Raise',
  'front raise dumbbell': 'Front Raise',
  'reverse fly dumbbell': 'Reverse Fly',
  'chest fly dumbbell': 'Dumbbell Fly',
  'cable fly crossover': 'Cable Crossover',
  // Bodyweight / core
  'push up': 'Push-up',
  'dip weighted': 'Dip',
  'triceps dip weighted': 'Dip',
  'crunch weighted': 'Crunch',
  'hanging leg raise': 'Hanging Leg Raise',
}

/**
 * Resolves each unique import name against the merged catalog. Customs are
 * indexed AFTER wger so a user's own exercise wins a key collision — if they
 * already made "Bench Press", their history should keep pointing at it.
 */
export function matchExercises(
  names: string[],
  catalog: CatalogEntry[],
): Map<string, ExerciseResolution> {
  const index = new Map<string, CatalogEntry>()
  for (const entry of catalog) {
    const key = normalizeKey(entry.name)
    const existing = index.get(key)
    // First entry wins within a source; customs override wger on collision.
    if (!existing || (existing.source === 'wger' && entry.source === 'custom')) {
      index.set(key, entry)
    }
  }

  const resolutions = new Map<string, ExerciseResolution>()
  for (const name of names) {
    if (resolutions.has(name)) continue

    // Direct normalized matches first ACROSS all candidate keys, aliases
    // second: a catalog exercise that literally carries the import's words
    // ("Barbell Bench Press") must outrank a curated remap of them.
    let entry: CatalogEntry | undefined
    const keys = candidateKeys(name)
    for (const key of keys) {
      entry = index.get(key)
      if (entry) break
    }
    if (!entry) {
      for (const key of keys) {
        const aliasTarget = EXERCISE_ALIASES[key]
        if (aliasTarget !== undefined) {
          entry = index.get(normalizeKey(aliasTarget))
          if (entry) break
        }
      }
    }

    resolutions.set(
      name,
      entry
        ? { kind: 'match', source: entry.source, id: entry.id, name: entry.name }
        : { kind: 'create' },
    )
  }
  return resolutions
}

/**
 * Best-effort category for an auto-created custom (custom_exercises.category
 * is NOT NULL and wger's fixed 8-set). Keyword heuristic over the movement
 * name; 'Chest' is the arbitrary-but-documented fallback. A wrong guess only
 * affects catalog filtering — never scoring or history.
 */
export function guessCategory(name: string): ExerciseCategory {
  const words = normalizeKey(name).split(' ')
  const has = (...targets: string[]) => targets.some((t) => words.includes(t))
  if (has('calf', 'calves')) return 'Calves'
  if (has('squat', 'leg', 'lunge', 'thrust', 'glute', 'hamstring', 'quad', 'hip')) return 'Legs'
  if (has('crunch', 'plank', 'ab', 'abs', 'situp', 'oblique')) return 'Abs'
  if (has('curl', 'tricep', 'triceps', 'bicep', 'biceps', 'pushdown', 'skullcrusher')) return 'Arms'
  if (has('shoulder', 'lateral', 'delt', 'shrug', 'overhead')) return 'Shoulders'
  if (has('row', 'pulldown', 'pull', 'chin', 'deadlift', 'back', 'lat')) return 'Back'
  if (has('run', 'bike', 'cycling', 'elliptical', 'treadmill', 'rowing', 'ski')) return 'Cardio'
  return 'Chest'
}
