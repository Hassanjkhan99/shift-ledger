-- audit_packs immutability (#120). A generated pack's metadata (attachment_id, filters snapshot,
-- record_count, chain_head_hash) IS the inspection evidence; once written it must never change. Mirror
-- the evidence / activity_log append-only guards: reject UPDATE/DELETE/TRUNCATE at the DB level so a
-- tenant-scoped raw write by app_user cannot rewrite a pack's recorded scope or chain head after export.
-- (Retention-driven removal, if ever needed, would be a separate SECURITY DEFINER path, like completions.)

CREATE OR REPLACE FUNCTION reject_audit_pack_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_packs is immutable: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_packs_no_update"
  BEFORE UPDATE ON "audit_packs"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_pack_mutation();

CREATE TRIGGER "audit_packs_no_delete"
  BEFORE DELETE ON "audit_packs"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_pack_mutation();

CREATE TRIGGER "audit_packs_no_truncate"
  BEFORE TRUNCATE ON "audit_packs"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_pack_mutation();
