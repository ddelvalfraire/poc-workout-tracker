/**
 * Whether two instants fall on the same calendar day IN THE RUNTIME'S LOCAL
 * TIMEZONE. Only the client can answer this — the server's "day" may differ
 * from the user's — so every consumer is a client component that runs the
 * check after mount (see today-workouts.tsx / trained-today-gate.tsx).
 *
 * This replaces rolling-hour windows for "today" semantics: a 9pm completion
 * is yesterday's training at 7am the next morning, even though only 10h
 * passed. Year/month/date triple equality (not date-string formatting) keeps
 * it allocation-free and unambiguous across DST transitions.
 */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
