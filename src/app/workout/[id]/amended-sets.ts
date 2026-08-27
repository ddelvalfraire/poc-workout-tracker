import { setSnapshotKey } from "@/db/workout-set-diff";

/**
 * Which SETS on this page were changed after the fact.
 *
 * The changelog below the record answers "what moved"; this answers "where",
 * so a reader scanning the set rows sees the amended numbers without opening
 * anything. The mark comes from the log's own snapshots — never from
 * re-diffing the workout — so a row is marked if and only if an amendment
 * event says so.
 */

/** The shape a set-level event carries in its jsonb columns. Read defensively:
 *  `before`/`after` are `unknown` at the type level and untyped in the
 *  database, and an event describing something OTHER than a set (a
 *  workout-level note, a future subject) must simply not match. */
function snapshotKey(snapshot: unknown): string | null {
  if (typeof snapshot !== "object" || snapshot === null) return null;
  const { source, wgerExerciseId, setNumber } = snapshot as Record<string, unknown>;
  if (typeof source !== "string") return null;
  if (typeof wgerExerciseId !== "number" || typeof setNumber !== "number") return null;
  return setSnapshotKey(source, wgerExerciseId, setNumber);
}

export interface AmendedSetEvent {
  kind: string;
  before: unknown;
  after: unknown;
}

/**
 * Set-identity keys (`setSnapshotKey`) touched by an AMENDMENT, from the
 * session's event stream.
 *
 * `after` is read first and `before` is the fallback: a correction that
 * REMOVED a set has no after-image, and the row it removed is gone from the
 * page anyway — but reading both keeps the key derivation honest for the
 * events that do carry only one side.
 */
export function amendedSetKeys(events: readonly AmendedSetEvent[]): Set<string> {
  const keys = new Set<string>();
  for (const event of events) {
    if (event.kind !== "amendment") continue;
    const key = snapshotKey(event.after) ?? snapshotKey(event.before);
    if (key !== null) keys.add(key);
  }
  return keys;
}
