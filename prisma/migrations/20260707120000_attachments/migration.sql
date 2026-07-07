-- Attachments (§8.16 - R2 object metadata) + evidence.attachment_id FK + D4/value-shape CHECKs (#104).
-- Parent epic #12 (Cloudflare R2 storage + attachment rules). This is the DB foundation ONLY: the R2
-- client + presign (#105), finalize/checksum/EXIF (#106), and the signed GET view (#107) build on it.
--
-- attachments is a MUTABLE table (soft-delete via deleted_at, has updated_at). Unlike evidence /
-- task_completions / activity_log it is NOT append-only: status/byte_size/checksum_sha256 are written
-- once at finalize (#106). RLS ENABLE + FORCE + tenant_isolation mirror every other tenant table.
--
-- Composite FKs / CHECKs live ONLY in this migration (Prisma cannot express them); the schema.prisma
-- @relation definitions stay single-column, so `prisma migrate dev` drift against them is
-- expected/known - the same convention as #94 (composite tenant FKs) and #95 (actor-membership FKs).

-- ============================================================================
-- attachments (§8.16)
-- ============================================================================
CREATE TABLE "attachments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "r2_bucket" TEXT NOT NULL,
    "r2_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" BIGINT,
    "checksum_sha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id"),
    -- status domain: pending -> uploaded (set on finalize). A soft-deleted row keeps its status.
    CONSTRAINT "attachments_status_check" CHECK ("status" IN ('pending', 'uploaded')),
    -- F6: once an object is 'uploaded' its integrity checksum + size are REQUIRED (they are the
    -- tamper-evidence folded into the #13 hash chain). A 'pending' row has neither yet. This makes
    -- an "uploaded but unverifiable" attachment unrepresentable at the DB level, independent of the
    -- app finalize path (#106) - reinforcing #106's fail-closed guarantee.
    CONSTRAINT "attachments_uploaded_requires_checksum"
      CHECK ("status" <> 'uploaded' OR ("checksum_sha256" IS NOT NULL AND "byte_size" IS NOT NULL))
);

-- ============================================================================
-- Indexes / unique constraints
-- ============================================================================
-- One R2 object per (bucket, key) - a key is never reused across attachment rows.
CREATE UNIQUE INDEX "attachments_r2_bucket_r2_key_key" ON "attachments"("r2_bucket", "r2_key");
-- Status scan within an org (e.g. sweep pending uploads).
CREATE INDEX "attachments_organization_id_status_idx" ON "attachments"("organization_id", "status");
-- Composite-FK target: required so evidence.(organization_id, attachment_id) can reference it.
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_id_key" UNIQUE ("organization_id", "id");

-- ============================================================================
-- Foreign keys (ON DELETE RESTRICT - audit integrity, no cascading hard delete; §8.0).
-- ============================================================================
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- uploaded_by: identity FK to the global users table. Nullable - a system/export-generated object
-- (§8.22 reuses this table for PDFs/CSVs) has no human uploader.
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- uploaded_by tenant-membership (composite, #95 pattern): a named uploader MUST be a member of THIS
-- org. memberships carries UNIQUE(organization_id, user_id), so the key can only resolve within the
-- row's own org. Nullable + MATCH SIMPLE => a NULL uploaded_by is not enforced.
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_membership_fkey" FOREIGN KEY ("organization_id", "uploaded_by") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Row-Level Security (ENABLE + FORCE + tenant_isolation) - mirrors every tenant table.
-- Predicate reads the transaction-local GUC app.current_org_id; unset => NULL => zero rows.
-- ============================================================================
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "attachments"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ============================================================================
-- evidence.attachment_id -> attachments (the FK deferred in 20260703140000_completions_evidence).
-- Single-column identity FK + tenant-qualified composite (organization_id, attachment_id) ->
-- attachments(organization_id, id) (#94 pattern) so an evidence row in org A can never point at an
-- org-B attachment (FK checks bypass RLS). Nullable + MATCH SIMPLE => evidence with no attachment
-- stays valid.
-- ============================================================================
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_attachment_tenant_fkey" FOREIGN KEY ("organization_id", "attachment_id") REFERENCES "attachments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Evidence attachment / value-shape CHECKs (D4; deferred from #53/#86).
-- ============================================================================

-- D4 binary-requires-attachment: photo/file ALWAYS carry a binary attachment.
-- 'signature' is exempt in BOTH directions: a drawn signature needs an attachment, a typed one does
-- not, and that drawn-vs-typed distinction is NOT stored on the row - so it is enforced by
-- requiresAttachment() at the app write layer (src/lib/attachments.ts), not by this CHECK.
ALTER TABLE "evidence"
  ADD CONSTRAINT "evidence_binary_requires_attachment"
  CHECK ("type" NOT IN ('photo', 'file') OR "attachment_id" IS NOT NULL);

-- Non-binary evidence must NOT carry an attachment (note/temperature/checkbox/initials are data, not
-- files). Keeps a stray attachment_id off rows that should never reference R2.
ALTER TABLE "evidence"
  ADD CONSTRAINT "evidence_nonbinary_forbids_attachment"
  CHECK ("type" NOT IN ('note', 'temperature', 'checkbox', 'initials') OR "attachment_id" IS NULL);

-- Value-shape: each typed evidence kind carries its value in the right column so a row cannot claim
-- to be a temperature/checkbox/note/initials with no actual value. photo/file/signature carry their
-- proof in the attachment (or, for typed signature/initials, in value_text) and are unconstrained here.
ALTER TABLE "evidence"
  ADD CONSTRAINT "evidence_value_shape"
  CHECK (
    ("type" <> 'temperature' OR "value_numeric" IS NOT NULL)
    AND ("type" <> 'checkbox' OR "value_bool" IS NOT NULL)
    AND ("type" NOT IN ('note', 'initials') OR "value_text" IS NOT NULL)
  );
