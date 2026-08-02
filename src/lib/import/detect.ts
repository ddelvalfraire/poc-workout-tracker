import { parseCsv, headerIndex } from './csv'
import type { ImportSource } from './types'

/**
 * Header-driven format detection — versions of both exports drift, so we key
 * on the columns least likely to move: Strong's "Workout Name" + "Set Order"
 * vs Hevy's "exercise_title" + "set_index". Only the first line is parsed.
 * Returns null when neither signature matches (the route turns that into an
 * honest "not a Strong or Hevy export" error, never a guess).
 */
export function detectImportSource(text: string): ImportSource | null {
  // Cap the sniff: the header lives in the first line; a 20MB file must not
  // be fully CSV-parsed just to identify itself.
  const firstLine = text.slice(0, 4096).split(/\r\n|\r|\n/, 1)[0] ?? ''
  const [header] = parseCsv(firstLine)
  if (!header) return null
  const columns = headerIndex(header)

  const isStrong =
    columns.has('workout name') && columns.has('set order') && columns.has('exercise name')
  if (isStrong) return 'strong'

  const isHevy =
    columns.has('exercise_title') &&
    columns.has('set_index') &&
    (columns.has('weight_kg') || columns.has('weight_lbs'))
  if (isHevy) return 'hevy'

  return null
}
