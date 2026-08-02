/**
 * Minimal RFC-4180-style CSV reader for the history importer — no dependency:
 * the two export formats need exactly quoted fields (commas/newlines/escaped
 * quotes inside), CRLF tolerance, and BOM stripping, nothing more. A hand
 * parser keeps the trust boundary small and exhaustively testable.
 *
 * Deliberately forgiving where exports drift: a stray quote inside an
 * unquoted field is kept verbatim, and an unterminated quoted field at EOF
 * yields what was read (never throws — the row-level validators downstream
 * decide what's usable).
 */

/** Parses CSV text into rows of string fields. Empty lines are dropped. */
export function parseCsv(text: string): string[][] {
  // Strip a UTF-8 BOM — Excel and some exporters prepend one, and it would
  // otherwise glue itself onto the first header name.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  // Tracks whether the current row has any content (a field started or a
  // delimiter seen) so blank lines don't emit [''].
  let rowHasContent = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true
      rowHasContent = true
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      rowHasContent = true
      continue
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++
      if (rowHasContent || field.length > 0) {
        row.push(field)
        rows.push(row)
      }
      row = []
      field = ''
      rowHasContent = false
      continue
    }
    field += char
  }

  if (rowHasContent || field.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

/** Case-insensitive header→index map ("Workout Name" and "workout name" are
 *  the same column). Later duplicates lose — the first occurrence wins. */
export function headerIndex(headerRow: string[]): Map<string, number> {
  const map = new Map<string, number>()
  headerRow.forEach((name, i) => {
    const key = name.trim().toLowerCase()
    if (!map.has(key)) map.set(key, i)
  })
  return map
}

/** Reads one cell by header name, trimmed; missing column/cell → ''. */
export function cell(row: string[], columns: Map<string, number>, name: string): string {
  const index = columns.get(name)
  if (index === undefined) return ''
  return (row[index] ?? '').trim()
}
