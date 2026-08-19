-- Account deletion must keep consent_events (CA ARL >= 3-year retention) but
-- sever them from the person: user_id is replaced with an irreversible
-- pseudonym. 0047's trigger blocks ALL mutation, so this replaces the
-- function with a GUC-gated version: the ONE sanctioned path
-- (pseudonymizeConsentRecords in src/db/consent.ts) runs
-- `SET LOCAL app.consent_pseudonymize = 'on'` inside its transaction, and
-- only then may rows change. SET LOCAL scopes the setting to that
-- transaction — no session leaks, and a careless migration or compromised
-- app credential still hits the exception. consent_documents keeps its
-- unconditional trigger (0048): documents are not user-scoped, so deletion
-- never needs to touch them.
CREATE OR REPLACE FUNCTION consent_events_block_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.consent_pseudonymize', true) = 'on' THEN
    IF TG_OP = 'UPDATE' THEN
      RETURN NEW;
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'consent_events is append-only (%.% attempted)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
