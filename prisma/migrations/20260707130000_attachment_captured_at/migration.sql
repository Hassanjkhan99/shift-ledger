-- Attachment capture timestamp (#106; parent epic #12). Additive column only.
--
-- On finalize we strip EXIF/GPS from photos (GDPR data-minimization, §22) but PRESERVE the single
-- useful field - the capture timestamp - into our OWN metadata column (never trusting raw EXIF
-- afterwards). Nullable: non-photo objects, or photos without a DateTimeOriginal tag, leave it null.
-- Not in the write-once guard's frozen set (organization_id/r2_bucket/r2_key/status/checksum/byte_size),
-- so finalize may set it in the same pending -> uploaded update.
ALTER TABLE "attachments" ADD COLUMN "captured_at" TIMESTAMPTZ(6);
