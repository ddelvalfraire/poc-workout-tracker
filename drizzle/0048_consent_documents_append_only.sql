-- consent_documents holds the text consent events point at — mutable text
-- would defeat the sha256 evidence chain (an "updated" document silently
-- rewrites what every referencing event appears to have accepted). Same
-- append-only trigger as consent_events (0047); new versions are new rows.
CREATE OR REPLACE FUNCTION consent_documents_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'consent_documents is append-only (%.% attempted)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER consent_documents_append_only
BEFORE UPDATE OR DELETE ON "consent_documents"
FOR EACH ROW EXECUTE FUNCTION consent_documents_block_mutation();
