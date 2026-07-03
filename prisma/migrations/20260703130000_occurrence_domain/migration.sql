-- Occurrence domain (#8; §8.11 task_templates, §8.12 scheduled_tasks, §8.13 task_occurrences).
-- Hand-written to match schema.prisma AND to express what Prisma cannot: the partial overdue-sweep
-- index, the mutually-exclusive-assignee CHECK, and RLS (ENABLE + FORCE + tenant_isolation policy).
-- These 3 tables are MUTABLE (soft-delete via deleted_at), NOT append-only — no reject trigger.

-- ============================================================================
-- Enums
-- ============================================================================

CREATE TYPE "check_type" AS ENUM ('temperature', 'cleaning', 'allergen', 'opening', 'closing', 'generic');

CREATE TYPE "evidence_type" AS ENUM ('note', 'photo', 'temperature', 'checkbox', 'initials', 'signature', 'file');

CREATE TYPE "recurrence_freq" AS ENUM ('daily', 'weekly', 'monthly');

-- Canonical per D1/F8 (§7.1). §9.3's `scheduled` is drift — `pending` is correct.
CREATE TYPE "occurrence_status" AS ENUM ('pending', 'due', 'overdue', 'completed', 'completed_late', 'failed', 'skipped', 'cancelled');

-- ============================================================================
-- Tables
-- ============================================================================

-- §8.11 task_templates
CREATE TABLE "task_templates" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "source_library_id" UUID,
    "check_type" "check_type" NOT NULL,
    "title" TEXT NOT NULL,
    "title_i18n" JSONB,
    "instructions" TEXT,
    "required_evidence" "evidence_type"[] NOT NULL DEFAULT ARRAY[]::"evidence_type"[],
    "target_config_json" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

-- §8.12 scheduled_tasks
CREATE TABLE "scheduled_tasks" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "task_template_id" UUID NOT NULL,
    "recurrence_json" JSONB NOT NULL,
    "recurrence_freq" "recurrence_freq" NOT NULL,
    "time_of_day" TIME(6) NOT NULL,
    "timezone" TEXT NOT NULL,
    "assignee_role" "org_role",
    "assignee_user_id" UUID,
    "grace_minutes" INTEGER NOT NULL DEFAULT 15,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- §8.13 task_occurrences
CREATE TABLE "task_occurrences" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "scheduled_task_id" UUID NOT NULL,
    "task_template_id" UUID NOT NULL,
    "check_type" "check_type" NOT NULL,
    "occurrence_local_date" DATE NOT NULL,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "occurrence_status" NOT NULL DEFAULT 'pending',
    "assignee_role" "org_role",
    "assignee_user_id" UUID,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "task_occurrences_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- Constraints
-- ============================================================================

-- §8.12: exactly one of (assignee_role, assignee_user_id) is non-null.
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_assignee_exactly_one"
  CHECK (("assignee_role" IS NOT NULL) <> ("assignee_user_id" IS NOT NULL));

-- ============================================================================
-- Indexes
-- ============================================================================

-- task_templates
CREATE INDEX "task_templates_organization_id_is_active_deleted_at_idx" ON "task_templates"("organization_id", "is_active", "deleted_at");
CREATE INDEX "task_templates_organization_id_check_type_idx" ON "task_templates"("organization_id", "check_type");

-- scheduled_tasks
CREATE INDEX "scheduled_tasks_organization_id_is_active_deleted_at_idx" ON "scheduled_tasks"("organization_id", "is_active", "deleted_at");
CREATE INDEX "scheduled_tasks_organization_id_outlet_id_is_active_idx" ON "scheduled_tasks"("organization_id", "outlet_id", "is_active");
-- Drives the daily generation-job scan for active schedules (§8.12).
CREATE INDEX "scheduled_tasks_is_active_ends_on_idx" ON "scheduled_tasks"("is_active", "ends_on");

-- task_occurrences
CREATE UNIQUE INDEX "task_occurrences_scheduled_task_id_occurrence_local_date_key" ON "task_occurrences"("scheduled_task_id", "occurrence_local_date");
-- Today dashboard.
CREATE INDEX "task_occurrences_org_prop_outlet_date_status_idx" ON "task_occurrences"("organization_id", "property_id", "outlet_id", "occurrence_local_date", "status");
-- Overdue sweep: PARTIAL index over only the live window (§8.13). The sweep is org-agnostic
-- and filters by status/due_at, so it must not carry organization_id as a leading key here.
CREATE INDEX "task_occurrences_sweep_idx" ON "task_occurrences"("status", "due_at") WHERE "status" IN ('pending', 'due');
-- "My tasks today".
CREATE INDEX "task_occurrences_org_assignee_date_idx" ON "task_occurrences"("organization_id", "assignee_user_id", "occurrence_local_date");
-- Org-wide missed/failed rollups.
CREATE INDEX "task_occurrences_org_status_date_idx" ON "task_occurrences"("organization_id", "status", "occurrence_local_date");

-- ============================================================================
-- Foreign keys (all ON DELETE RESTRICT per §8.0 — audit integrity, no cascading hard delete).
-- source_library_id has no FK yet (template_library is a later milestone).
-- ============================================================================

ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_task_template_id_fkey" FOREIGN KEY ("task_template_id") REFERENCES "task_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_scheduled_task_id_fkey" FOREIGN KEY ("scheduled_task_id") REFERENCES "scheduled_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_task_template_id_fkey" FOREIGN KEY ("task_template_id") REFERENCES "task_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Row-Level Security (ENABLE + FORCE + tenant_isolation) — mirrors rls_immutability.
-- Predicate reads transaction-local GUC app.current_org_id; unset => NULL => zero rows.
-- Mutable tables: NO append-only reject trigger (unlike activity_log).
-- ============================================================================

ALTER TABLE "task_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "task_templates"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "scheduled_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scheduled_tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "scheduled_tasks"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "task_occurrences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_occurrences" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "task_occurrences"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
