-- Finalize repoints to an immutable, content-addressed key (#116). The client presigns a PUT to the
-- upload key and could re-PUT different bytes to it while the presign is still valid; if finalize already
-- recorded a checksum, that would silently swap the object (defeating F6). Fix: finalize copies the
-- sanitized bytes to a NEW content-addressed key `org/{org}/evidence/{attachment_id}-{sha256}.{ext}` that
-- the client never received a presign for, and repoints attachments.r2_key to it. So r2_key must be
-- allowed to change EXACTLY ONCE, during the pending->uploaded finalize; it stays immutable otherwise.
--
-- Redefine the write-once guard (CREATE OR REPLACE; the trigger is unchanged): same frozen set as #115,
-- except r2_key is now conditionally mutable during finalize.
CREATE OR REPLACE FUNCTION guard_attachment_update() RETURNS trigger AS $$
BEGIN
  -- r2_key: mutable ONLY on the pending->uploaded transition (the finalize repoint); immutable otherwise.
  IF NEW."r2_key" <> OLD."r2_key"
     AND NOT (OLD."status" = 'pending' AND NEW."status" = 'uploaded') THEN
    RAISE EXCEPTION 'attachments: r2_key is immutable except during finalize'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."organization_id" <> OLD."organization_id"
     OR NEW."r2_bucket" <> OLD."r2_bucket"
     OR NEW."content_type" <> OLD."content_type"
     OR NEW."created_at" <> OLD."created_at"
     OR NEW."uploaded_by" IS DISTINCT FROM OLD."uploaded_by" THEN
    RAISE EXCEPTION 'attachments: organization_id/r2_bucket/content_type/created_at/uploaded_by are immutable'
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
