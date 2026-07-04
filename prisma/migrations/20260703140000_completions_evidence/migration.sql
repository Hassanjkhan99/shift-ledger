-- Completions + evidence (#53; §8.14 task_completions, §8.15 evidence).
-- Hand-written to match schema.prisma AND to express what Prisma cannot: the partial
-- current-completion UNIQUE index, RLS (ENABLE + FORCE + tenant_isolation policy), and the
-- append-only reject triggers.
--
-- IMMUTABILITY (F3/audit): unlike the occurrence-domain tables (which are mutable, soft-delete),
-- task_completions and evidence are COMPLIANCE RECORDS — append-only, NO updated_at, NO deleted_at.
-- UPDATE/DELETE/TRUNCATE are rejected at the DB level by reject_* triggers, mirroring activity_log.
-- Corrections do NOT mutate a row: they insert a NEW version (version+1, supersedes_id) and flip the
-- prior row's is_current. That narrow is_current-flip is the ONE permitted update, done via a
-- SECURITY DEFINER path that also writes activity_log — that path is DEFERRED to M4 #17. Until then
-- completions are fully immutable, which is correct for this milestone.

-- ============================================================================
-- Enums
-- ============================================================================

CREATE TYPE "completion_result" AS ENUM ('pass', 'fail');

-- ============================================================================
-- Tables
-- ============================================================================

-- §8.14 task_completions (versioned, immutable / append-only)
CREATE TABLE "task_completions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "task_occurrence_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "supersedes_id" UUID,
    "client_submission_id" UUID NOT NULL,
    "result" "completion_result" NOT NULL,
    "entered_values_json" JSONB NOT NULL DEFAULT '{}',
    "measured_numeric" NUMERIC,
    "completed_by" UUID NOT NULL,
    "actor_confirmation_method" TEXT NOT NULL DEFAULT 'session',
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "client_reported_at" TIMESTAMPTZ(6),
    "device_meta_json" JSONB,
    "edit_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_completions_pkey" PRIMARY KEY ("id"),
    -- version is 1-based and monotonic; a non-positive version is meaningless (P2).
    CONSTRAINT "task_completions_version_positive" CHECK ("version" >= 1),
    -- A corrected version (v>=2) must carry its provenance: WHY (edit_reason) and WHAT it replaces
    -- (supersedes_id). v1 is the original and carries neither (P2).
    CONSTRAINT "task_completions_correction_provenance"
      CHECK ("version" = 1 OR ("edit_reason" IS NOT NULL AND "supersedes_id" IS NOT NULL))
);

-- §8.15 evidence (immutable / append-only)
CREATE TABLE "evidence" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "task_completion_id" UUID NOT NULL,
    "type" "evidence_type" NOT NULL,
    "value_text" TEXT,
    "value_numeric" NUMERIC,
    "value_bool" BOOLEAN,
    -- attachment_id: no FK yet. The attachments table (§8.16) + this FK land in M3 #12; until then
    -- this is a plain nullable UUID column so evidence can reference binary blobs once they exist.
    "attachment_id" UUID,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- Unique constraints / indexes
-- ============================================================================

-- task_completions
-- Current-completion guard: at most one is_current row per occurrence (§8.14, §"Current completion guard").
CREATE UNIQUE INDEX "task_completions_occurrence_current_key" ON "task_completions"("task_occurrence_id") WHERE "is_current";
-- Monotonic version per occurrence.
CREATE UNIQUE INDEX "task_completions_task_occurrence_id_version_key" ON "task_completions"("task_occurrence_id", "version");
-- Idempotency (F2): a client_submission_id is unique within an org (org-scoped; #52 builds the write semantics on top).
CREATE UNIQUE INDEX "task_completions_organization_id_client_submission_id_key" ON "task_completions"("organization_id", "client_submission_id");
-- Version history scan.
CREATE INDEX "task_completions_org_occurrence_version_idx" ON "task_completions"("organization_id", "task_occurrence_id", "version");
-- Fail rollups / exports.
CREATE INDEX "task_completions_org_result_recorded_at_idx" ON "task_completions"("organization_id", "result", "recorded_at");

-- evidence
CREATE INDEX "evidence_org_completion_idx" ON "evidence"("organization_id", "task_completion_id");
CREATE INDEX "evidence_org_type_idx" ON "evidence"("organization_id", "type");

-- ============================================================================
-- Foreign keys (all ON DELETE RESTRICT per §8.0 — audit integrity, no cascading hard delete).
-- attachment_id has no FK yet (attachments / §8.16 is M3 #12).
-- ============================================================================

ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_task_occurrence_id_fkey" FOREIGN KEY ("task_occurrence_id") REFERENCES "task_occurrences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "task_completions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "evidence" ADD CONSTRAINT "evidence_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_task_completion_id_fkey" FOREIGN KEY ("task_completion_id") REFERENCES "task_completions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Row-Level Security (ENABLE + FORCE + tenant_isolation) — mirrors rls_immutability.
-- Predicate reads transaction-local GUC app.current_org_id; unset => NULL => zero rows.
-- ============================================================================

ALTER TABLE "task_completions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_completions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "task_completions"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "evidence"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ============================================================================
-- Append-only enforcement (database-level) — mirrors activity_log's reject trigger.
-- task_completions + evidence are compliance records: UPDATE/DELETE/TRUNCATE are rejected.
-- The narrow is_current-flip needed by versioned corrections is a SECURITY DEFINER path
-- deferred to M4 #17; until then these tables are fully immutable.
-- ============================================================================

-- F3 — recorded_at is server-authoritative (defense in depth over the column DEFAULT). A DEFAULT only
-- fires when the INSERT omits the column; a caller bypassing buildCompletionInsert() could still supply
-- a backdated recorded_at. This BEFORE INSERT trigger unconditionally overwrites it with now(), so the
-- compliance timestamp can never be driven by the client. (client_reported_at stays advisory, untouched.)
CREATE OR REPLACE FUNCTION set_task_completion_recorded_at() RETURNS trigger AS $$
BEGIN
  NEW.recorded_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "task_completions_stamp_recorded_at"
  BEFORE INSERT ON "task_completions"
  FOR EACH ROW EXECUTE FUNCTION set_task_completion_recorded_at();

CREATE OR REPLACE FUNCTION reject_task_completion_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'task_completions is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "task_completions_no_update"
  BEFORE UPDATE ON "task_completions"
  FOR EACH ROW EXECUTE FUNCTION reject_task_completion_mutation();

CREATE TRIGGER "task_completions_no_delete"
  BEFORE DELETE ON "task_completions"
  FOR EACH ROW EXECUTE FUNCTION reject_task_completion_mutation();

CREATE TRIGGER "task_completions_no_truncate"
  BEFORE TRUNCATE ON "task_completions"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_task_completion_mutation();

CREATE OR REPLACE FUNCTION reject_evidence_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'evidence is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "evidence_no_update"
  BEFORE UPDATE ON "evidence"
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();

CREATE TRIGGER "evidence_no_delete"
  BEFORE DELETE ON "evidence"
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();

CREATE TRIGGER "evidence_no_truncate"
  BEFORE TRUNCATE ON "evidence"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_evidence_mutation();
