/** Public literals only: safe to import from browser components without process.env. */
export const DEFAULT_WGER_API_BASE_URL = 'https://wger.de/api/v2'
export const DEFAULT_LANGFUSE_BASE_URL = 'https://cloud.langfuse.com'

/**
 * Cross-cutting tunables that were previously copy-pasted at each call site.
 * This is deliberately NOT a dumping ground for every module-local constant —
 * most TTLs/limits (e.g. src/lib/ops/*, src/db/program-events.ts) are owned by
 * a single module and stay there. A value moves here only once a second
 * module needs the same literal.
 */

/**
 * Redis "already evaluated this window" markers for the proposal-suggestion
 * jobs (volume progression, reactive deload). Purely a cost cap — one real
 * evaluation per (program, week) — never a correctness guarantee; each job's
 * partial unique index on the proposals table is what actually prevents a
 * duplicate. Shared by src/db/volume-progression.ts and src/db/reactive-deload.ts.
 */
export const PROPOSAL_MARKER_TTL_SECONDS = 60 * 60 * 24 * 90
