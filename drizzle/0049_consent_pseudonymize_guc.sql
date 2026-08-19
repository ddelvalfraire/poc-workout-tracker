-- Account deletion must keep consent_events (CA ARL >= 3-year retention) but
-- sever them from the person: user_id is replaced with an irreversible
-- pseudonym. 0047's trigger blocks ALL mutation, so this replaces the
-- function with a GUC-gated version: the ONE sanctioned path
-- (pseudonymizeConsentRecords in src/db/consent.ts) runs
-- `SET LOCAL app.consent_pseudonymize = 'on'` inside its transaction, and
-- only then may rows change. SET LOCAL scopes the setting to that
-- transaction — no session leaks.
--
-- The gate is deliberately NARROW (review finding on the first draft, which
-- let the GUC through to DELETE and to any-column UPDATE): even with the
-- GUC set, the ONLY permitted mutation is an UPDATE that changes user_id
-- and nothing else. DELETE always raises — evidence rows are never
-- destroyable — and tampering with action/purpose/presentation/timestamps
-- raises even on the sanctioned path. consent_documents keeps its
-- unconditional trigger (0048): documents are not user-scoped, so deletion
-- never needs to touch them.
CREATE OR REPLACE FUNCTION consent_events_block_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.consent_pseudonymize', true) = 'on'
     AND TG_OP = 'UPDATE'
     AND NEW.id = OLD.id
     AND NEW.purpose = OLD.purpose
     AND NEW.action = OLD.action
     AND NEW.document_id IS NOT DISTINCT FROM OLD.document_id
     AND NEW.occurred_at = OLD.occurred_at
     AND NEW.ip_truncated IS NOT DISTINCT FROM OLD.ip_truncated
     AND NEW.user_agent IS NOT DISTINCT FROM OLD.user_agent
     AND NEW.presentation = OLD.presentation THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'consent_events is append-only (%.% attempted)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
