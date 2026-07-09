-- Attachment/evidence DB-integrity hardening (#115). Additive: a redefined write-once guard + new
-- CHECKs + an evidence binary-attachment trigger. Defense in depth for append-only evidence, so a
-- bad/abandoned/altered row can never become permanent audit evidence.

-- ============================================================================
-- 1. Freeze the FULL attachment audit-metadata set (not just the object pointer). Redefine the
--    write-once guard: organization_id/r2_bucket/r2_key/content_type/created_at/uploaded_by are
--    immutable; status is one-way (uploaded never reverts); checksum_sha256/byte_size/captured_at are
--    write-once (NULL -> value at finalize, then frozen). Still permits the finalize update + the
--    soft-delete tombstone (deleted_at/updated_at). CREATE OR REPLACE keeps the existing trigger.
-- ============================================================================
CREATE OR REPLACE FUNCTION guard_attachment_update() RETURNS trigger AS $$
BEGIN
  IF NEW."organization_id" <> OLD."organization_id"
     OR NEW."r2_bucket" <> OLD."r2_bucket"
     OR NEW."r2_key" <> OLD."r2_key"
     OR NEW."content_type" <> OLD."content_type"
     OR NEW."created_at" <> OLD."created_at"
     OR NEW."uploaded_by" IS DISTINCT FROM OLD."uploaded_by" THEN
    RAISE EXCEPTION 'attachments: organization_id/r2_bucket/r2_key/content_type/created_at/uploaded_by are immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'uploaded' AND NEW."status" <> 'uploaded' THEN
    RAISE EXCEPTION 'attachments: status cannot revert from uploaded' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."checksum_sha256" IS NOT NULL AND NEW."checksum_sha256" IS DISTINCT FROM OLD."checksum_sha256" THEN
    RAISE EXCEPTION 'attachments: checksum_sha256 is write-once' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."byte_size" IS NOT NULL AND NEW."byte_size" IS DISTINCT FROM OLD."byte_size" THEN
    RAISE EXCEPTION 'attachments: byte_size is write-once' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."captured_at" IS NOT NULL AND NEW."captured_at" IS DISTINCT FROM OLD."captured_at" THEN
    RAISE EXCEPTION 'attachments: captured_at is write-once' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. Attachment shape CHECKs. A pending row carries NO integrity metadata (so the write-once guard
--    can't freeze stale values a caller pre-set); a checksum is a 64-char lowercase hex sha256; a
--    byte_size is positive.
-- ============================================================================
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_pending_no_metadata"
  CHECK ("status" <> 'pending'
         OR ("checksum_sha256" IS NULL AND "byte_size" IS NULL AND "captured_at" IS NULL));
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_checksum_shape"
  CHECK ("checksum_sha256" IS NULL OR "checksum_sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_byte_size_positive"
  CHECK ("byte_size" IS NULL OR "byte_size" > 0);

-- ============================================================================
-- 3. Evidence value-column EXCLUSIVITY. The existing evidence_value_shape CHECK requires the RIGHT
--    column; this one forbids the OTHERS, so a row cannot carry contradictory proof (e.g. a
--    'temperature' that also has value_text). photo/file carry proof only in the attachment.
-- ============================================================================
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_value_exclusive" CHECK (
  ("type" = 'temperature' AND "value_numeric" IS NOT NULL AND "value_text" IS NULL AND "value_bool" IS NULL)
  OR ("type" = 'checkbox' AND "value_bool" IS NOT NULL AND "value_text" IS NULL AND "value_numeric" IS NULL)
  OR ("type" IN ('note', 'initials') AND "value_text" IS NOT NULL AND "value_numeric" IS NULL AND "value_bool" IS NULL)
  OR ("type" = 'signature' AND "value_numeric" IS NULL AND "value_bool" IS NULL)
  OR ("type" IN ('photo', 'file') AND "value_text" IS NULL AND "value_numeric" IS NULL AND "value_bool" IS NULL)
);

-- ============================================================================
-- 4. Binary evidence must reference an UPLOADED, non-tombstoned attachment. Because evidence is
--    append-only, an abandoned/pending or retention-deleted upload must never become permanent
--    evidence. BEFORE INSERT trigger; the lookup runs under the caller's RLS, so a cross-tenant
--    attachment id is simply not found and rejected.
-- ============================================================================
CREATE OR REPLACE FUNCTION guard_evidence_attachment() RETURNS trigger AS $$
DECLARE
  a_status text;
  a_deleted timestamptz;
BEGIN
  IF NEW."attachment_id" IS NOT NULL THEN
    SELECT status, deleted_at INTO a_status, a_deleted
      FROM attachments WHERE id = NEW."attachment_id";
    IF a_status IS NULL OR a_status <> 'uploaded' OR a_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'evidence: attachment_id must reference an uploaded, non-deleted attachment'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "evidence_attachment_uploaded"
  BEFORE INSERT ON "evidence"
  FOR EACH ROW EXECUTE FUNCTION guard_evidence_attachment();
