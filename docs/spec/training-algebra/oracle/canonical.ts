/**
 * canonical.ts — the one encoding every identity surface hashes or keys by
 * (P1): frame read keys, resolution digests, the program hash.
 *
 * CANONICAL JSON. JSON text with object keys sorted by UTF-16 code unit
 * (the default ordering of keys as strings), keys whose value is undefined
 * omitted, arrays in order, no whitespace. A number is written as ECMAScript
 * Number::toString writes it (shortest round-trip; `1e+21` style exponents
 * past 1e21; -0 as `0`); a non-finite number is `null`, as JSON has no
 * spelling for it. Strings are escaped as JSON.stringify escapes them.
 *
 * FNV-1a 32 runs over the UTF-16 CODE UNITS of that text (a character
 * outside the BMP contributes both surrogates), offset 0x811c9dc5, prime
 * 0x01000193, written as 8 lowercase hex digits.
 */

export function canonicalJson(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null'
  if (Array.isArray(x)) return `[${x.map((v) => (v === undefined || typeof v === 'function' ? 'null' : canonicalJson(v))).join(',')}]`
  const o = x as Record<string, unknown>
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined && typeof o[k] !== 'function')
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`
}

export function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** The digest of a value: FNV-1a over its canonical JSON. */
export const digest = (x: unknown): string => fnv1a(canonicalJson(x))
