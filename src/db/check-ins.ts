import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { db } from './index'
import { bodyMeasurements, bodyweightLogs, programs, progressPhotos } from './schema'

/**
 * The raw facts behind "is a body check-in due?" — one thin read, no policy.
 * The pure due rule lives in lib/check-in.ts; this module only answers "what
 * cadence does the active program suggest, and when did the user last log
 * anything body-shaped?".
 */

/** The active program's cadence plus the freshest timestamp per source. */
export interface CheckInFacts {
  programName: string
  /** programs.checkInEveryDays — guaranteed non-null by the query filter. */
  cadenceDays: number
  latestBodyweightAt: Date | null
  latestMeasurementAt: Date | null
  latestPhotoAt: Date | null
}

/**
 * Fetches the check-in facts for a user, or null when no active program
 * suggests a cadence (the common case — the three history reads are skipped
 * entirely then). "Active" mirrors getNextProgramDay: most recently updated
 * 'active' row wins. Latest-entry reads are order-by-desc-limit-1 on the
 * (user, timestamp) indexes — the same idiom as syncCurrentBodyweight.
 */
export async function getCheckInFacts(userId: string): Promise<CheckInFacts | null> {
  const [program] = await db
    .select({ name: programs.name, cadenceDays: programs.checkInEveryDays })
    .from(programs)
    .where(
      and(
        eq(programs.userId, userId),
        eq(programs.status, 'active'),
        isNotNull(programs.checkInEveryDays),
      ),
    )
    .orderBy(desc(programs.updatedAt))
    .limit(1)
  if (!program || program.cadenceDays === null) return null

  const [[bodyweight], [measurement], [photo]] = await Promise.all([
    db
      .select({ at: bodyweightLogs.weighedAt })
      .from(bodyweightLogs)
      .where(eq(bodyweightLogs.userId, userId))
      .orderBy(desc(bodyweightLogs.weighedAt))
      .limit(1),
    db
      .select({ at: bodyMeasurements.measuredAt })
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.userId, userId))
      .orderBy(desc(bodyMeasurements.measuredAt))
      .limit(1),
    db
      .select({ at: progressPhotos.takenAt })
      .from(progressPhotos)
      .where(eq(progressPhotos.userId, userId))
      .orderBy(desc(progressPhotos.takenAt))
      .limit(1),
  ])

  return {
    programName: program.name,
    cadenceDays: program.cadenceDays,
    latestBodyweightAt: bodyweight?.at ?? null,
    latestMeasurementAt: measurement?.at ?? null,
    latestPhotoAt: photo?.at ?? null,
  }
}
