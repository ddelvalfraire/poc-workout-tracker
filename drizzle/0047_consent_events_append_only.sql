-- consent_events is legal evidence (CA ARL >= 3-year retention; MHMDA
-- consent proof). The app layer never updates or deletes rows, but that is
-- convention; this trigger makes the ledger append-only at the database so a
-- careless migration or compromised app credential cannot silently rewrite
-- compliance records. Account deletion pseudonymizes the user id via a
-- dedicated path that will disable the trigger inside a controlled
-- transaction if ever needed.
CREATE OR REPLACE FUNCTION consent_events_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'consent_events is append-only (%.% attempted)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER consent_events_append_only
BEFORE UPDATE OR DELETE ON "consent_events"
FOR EACH ROW EXECUTE FUNCTION consent_events_block_mutation();
