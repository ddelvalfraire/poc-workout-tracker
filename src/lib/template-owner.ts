/**
 * The template library's system account. Curated templates are ordinary
 * `programs` rows owned by this pseudo-user with `visibility: 'public'` — no
 * new tables; the existing sharing/visibility model does the work. The id is
 * a well-known constant rather than an env var: Clerk user ids always start
 * with `user_`, so no real account can ever collide with it, and every
 * environment (dev, prod, CI) addresses the same owner without config drift.
 *
 * Rows under this owner are written only by `scripts/seed-templates.ts`
 * (manual, idempotent); users reach them read-only through `db/templates.ts`,
 * and adoption copies — never links — a template into the adopter's account.
 */
export const TEMPLATE_OWNER_USER_ID = 'system_templates'
