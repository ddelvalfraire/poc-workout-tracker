/**
 * Message DESCRIPTORS — how copy that lives outside JSX gets localized
 * (docs/I18N-KEYS.md §9).
 *
 * A pure function in `src/lib/**` must never return a sentence. It returns a
 * descriptor naming the catalog key it decided on, and the CALLER renders it
 * with its own translator. That keeps the function pure (its tests assert the
 * decision — which branch, what count — not an English string), keeps
 * translators out of every intermediate call site, and stays indifferent to
 * whether the renderer resolved `useTranslations` or `getTranslations`.
 */

/** Something that is DATA, not copy: a program name, a formatted weight, a
 *  workout title the user typed. It renders verbatim in every locale, and
 *  saying so in the type is the point — a data slot can never quietly become
 *  a hardcoded English string that no catalog check would catch. */
export interface Literal {
  literal: string
}

export type MessageValue = string | number | Date | Line

export interface Message<K extends string = string> {
  key: K
  /** ICU arguments. A nested descriptor value is rendered first (same
   *  namespace), which is how an optional fallback noun — "Workout" when the
   *  session has no name — stays one key instead of four. */
  values?: Record<string, MessageValue>
}

/** Either a catalog message or a literal fact. */
export type Line<K extends string = string> = Message<K> | Literal

/** The shape of a next-intl translator, narrowed to the keys a caller can be
 *  handed. Declared structurally so `useTranslations()` and `getTranslations()`
 *  both satisfy it without either being imported here. */
export type Translator<K extends string = string> = (
  key: K,
  values?: Record<string, string | number | Date>,
) => string

function isLiteral(line: Line): line is Literal {
  return 'literal' in line
}

/** Renders one descriptor. Nested descriptors resolve depth-first, so a
 *  message may carry another message as an argument. */
export function renderLine<K extends string>(t: Translator<K>, line: Line<K>): string {
  if (isLiteral(line)) return line.literal
  if (!line.values) return t(line.key)
  const values: Record<string, string | number | Date> = {}
  for (const [name, value] of Object.entries(line.values)) {
    values[name] =
      typeof value === 'object' && !(value instanceof Date)
        ? renderLine(t, value as Line<K>)
        : value
  }
  return t(line.key, values)
}

/** Renders a segment list. The separator is punctuation, not language: these
 *  lines are "fact · fact", not a sentence, so each fact is translated on its
 *  own and the joiner never needs a catalog entry. */
export function renderLines<K extends string>(
  t: Translator<K>,
  lines: readonly Line<K>[],
  separator = ' · ',
): string {
  return lines.map((line) => renderLine(t, line)).join(separator)
}
