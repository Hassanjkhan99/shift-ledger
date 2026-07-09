-- Export jobs (§8.22) + audit packs (§8.23) for the PDF audit pack (#14).
--
-- export_jobs is a MUTABLE state machine (§7.4: queued -> processing -> completed | failed) driven
-- through the F4 transition() choke point (status changes are audited in activity_log). audit_packs is
-- effectively immutable once written (the generated PDF/CSV lives in R2 via an attachments row). Both
-- carry the #94 tenant-qualified composite FKs and #95 actor-membership FK (constraints live ONLY here;
-- @relation stays single-column - expected `migrate dev` drift).

CREATE TYPE "export_job_status" AS ENUM ('queued', 'processing', 'completed', 'failed');

-- ============================================================================
-- export_jobs (§8.22)
-- ============================================================================
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "status" "export_job_status" NOT NULL DEFAULT 'queued',
    "requested_by" UUID NOT NULL,
    "filters_json" JSONB NOT NULL DEFAULT '{}',
    "audit_pack_id" UUID,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- audit_packs (§8.23)
-- ============================================================================
CREATE TABLE "audit_packs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "export_job_id" UUID NOT NULL,
    "attachment_id" UUID NOT NULL,
    "record_count" INTEGER NOT NULL DEFAULT 0,
    "filters_snapshot_json" JSONB NOT NULL DEFAULT '{}',
    -- activity_log row_hash at export time (F6): proves the audited scope was intact when generated.
    "chain_head_hash" TEXT,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_packs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_packs_record_count_nonneg" CHECK ("record_count" >= 0)
);

-- ============================================================================
-- Unique (composite-FK targets) + indexes
-- ============================================================================
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_org_id_key" UNIQUE ("organization_id", "id");
ALTER TABLE "audit_packs" ADD CONSTRAINT "audit_packs_org_id_key" UNIQUE ("organization_id", "id");
-- One pack per job.
CREATE UNIQUE INDEX "audit_packs_export_job_id_key" ON "audit_packs" ("export_job_id");
CREATE INDEX "export_jobs_org_status_idx" ON "export_jobs" ("organization_id", "status");
CREATE INDEX "audit_packs_org_generated_at_idx" ON "audit_packs" ("organization_id", "generated_at");
CREATE INDEX "audit_packs_org_export_job_idx" ON "audit_packs" ("organization_id", "export_job_id");

-- ============================================================================
-- Foreign keys (ON DELETE RESTRICT - audit integrity). Single-column to organizations/users; the
-- cross-row refs are ALSO tenant-qualified composite (#94). requested_by carries the membership FK (#95).
-- The export_jobs.audit_pack_id <-> audit_packs.export_job_id cycle is why FKs are added after both
-- tables exist; audit_pack_id is nullable (set on completion).
-- ============================================================================
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_membership_fkey" FOREIGN KEY ("organization_id", "requested_by") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_audit_pack_id_fkey" FOREIGN KEY ("organization_id", "audit_pack_id") REFERENCES "audit_packs"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_packs" ADD CONSTRAINT "audit_packs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_packs" ADD CONSTRAINT "audit_packs_export_job_id_fkey" FOREIGN KEY ("organization_id", "export_job_id") REFERENCES "export_jobs"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_packs" ADD CONSTRAINT "audit_packs_attachment_id_fkey" FOREIGN KEY ("organization_id", "attachment_id") REFERENCES "attachments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Row-Level Security (ENABLE + FORCE + tenant_isolation) - mirrors every tenant table.
-- ============================================================================
ALTER TABLE "export_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "export_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "export_jobs"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "audit_packs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_packs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "audit_packs"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
