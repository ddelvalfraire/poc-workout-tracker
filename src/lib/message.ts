/**
 * A message DESCRIPTOR: the catalog key a pure function DECIDED on, plus the
 * ICU arguments that key needs — never the sentence itself.
 *
 * Pure view logic (view-models, formatters, enum labels) returns one of these
 * and the rendering component turns it into words with
 * `t(message.key, message.values)`. Why not thread a translator in:
 *
 *  - the function stays pure, so its tests assert the DECISION (which branch,
 *    what count) rather than an English string that any copy edit invalidates;
 *  - every caller in a forwarding chain would otherwise have to carry a `t`;
 *  - server and client resolve translators differently (`getTranslations` vs
 *    `useTranslations`), and a descriptor does not care which one renders it.
 *
 * `key` is deliberately generic: a producer narrows it to the literal union of
 * keys it can actually emit, which is what lets next-intl type-check the key
 * against the catalog at the call site instead of accepting any string.
 */
export interface Message<K extends string = string> {
  readonly key: K
  readonly values?: Record<string, string | number>
}

/** The shape of both `useTranslations(ns)` and `await getTranslations(ns)` —
 *  structural, so a descriptor renders the same on the server and the client. */
type Translator<K extends string> = (key: K, values?: Record<string, string | number>) => string

/**
 * Renders a descriptor: `renderMessage(t, msg)`, i.e. `t(msg.key, msg.values)`
 * with the two-line null case folded in. Null passes through, so the many
 * "…or nothing to show" view-model returns stay one expression at the call
 * site instead of a widening ternary.
 */
export function renderMessage<K extends string>(t: Translator<K>, message: Message<K>): string
export function renderMessage<K extends string>(
  t: Translator<K>,
  message: Message<K> | null,
): string | null
export function renderMessage<K extends string>(
  t: Translator<K>,
  message: Message<K> | null,
): string | null {
  return message === null ? null : t(message.key, message.values)
}
