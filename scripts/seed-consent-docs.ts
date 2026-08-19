/**
 * Seeds/updates the consent_documents ledger from the generated legal
 * content — the deploy-of-data step that makes new document versions
 * consentable (the ledger stores the full text; the pages render the same
 * generated module, so the sha256 chain holds by construction).
 *
 * MANUAL INVOCATION ONLY (same law as seed-templates): content changes to
 * docs/legal are deploys of data — `npm run legal` first, commit, then run
 * this against the environment you mean to touch:
 *
 *   npm run db:seed-consent-docs      # reads DATABASE_URL from .env.local
 *
 * Idempotent by content hash: unchanged docs are no-ops; changed docs get a
 * new version row (append-only — the trigger forbids mutating old versions).
 * A NEW VERSION OF A MATERIAL DOC GATES USERS BEHIND RE-CONSENT once the 4c
 * middleware ships — run this deliberately, not casually.
 */
import { config } from 'dotenv'

config({ path: '.env.local' }) // plain node does not read .env.local
config() // …then .env, for environments that use it

async function main() {
  // Imports live inside main, AFTER dotenv ran: src/db/index.ts requires
  // DATABASE_URL at module init (same idiom as seed-templates).
  const { upsertConsentDocument } = await import('../src/db/consent')
  const { tos, privacy, healthNotice, analyticsNotice } = await import(
    '../src/lib/legal-content.generated'
  )

  const DOCS = [
    // ToS/health changes are material by default (they gate usage); the
    // analytics notice is optional-consent copy — still versioned, still
    // material:false so a wording tweak never locks anyone out.
    { docType: 'tos', content: tos, isMaterial: true },
    { docType: 'privacy', content: privacy, isMaterial: false },
    { docType: 'health_notice', content: healthNotice, isMaterial: true },
    { docType: 'analytics_notice', content: analyticsNotice, isMaterial: false },
  ] as const

  for (const doc of DOCS) {
    const result = await upsertConsentDocument({
      docType: doc.docType,
      contentMd: doc.content.contentMd,
      isMaterial: doc.isMaterial,
      effectiveAt: new Date(),
    })
    console.log(
      `${doc.docType}: v${result.version} ${result.unchanged ? '(unchanged)' : 'SEEDED — new version'}`,
    )
  }
  process.exit(0)
}

main().catch((error) => {
  console.error('seed-consent-docs failed', error)
  process.exit(1)
})
