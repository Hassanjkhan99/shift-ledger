-- Exceptions + corrective actions (#9; §8.17 exceptions, §8.18 corrective_actions).
-- Hand-written to match schema.prisma AND to express what Prisma cannot: RLS (ENABLE + FORCE +
-- tenant_isolation policy). Both tables are MUTABLE (soft-delete via deleted_at, have updated_at),
-- NOT append-only — no reject trigger (unlike activity_log / task_completions). The D2 state
-- machines (§7.2/§7.3) live in application code (src/lib/exceptions.ts) and route every status
-- change through the F4 transition() choke point.

-- ============================================================================
-- Enums (D2, §7.2/§7.3)
-- ============================================================================

CREATE TYPE "exception_status" AS ENUM ('open', 'acknowledged', 'in_progress', 'resolved', 'verified', 'reopened');

CREATE TYPE "corrective_status" AS ENUM ('open', 'assigned', 'done', 'verified', 'rejected');

-- ============================================================================
-- Tables
-- ============================================================================

-- §8.17 exceptions
CREATE TABLE "exceptions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "task_occurrence_id" UUID NOT NULL,
    "task_completion_id" UUID,
    "status" "exception_status" NOT NULL DEFAULT 'open',
    "severity" TEXT NOT NULL DEFAULT 'normal',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "opened_by" UUID,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "exceptions_pkey" PRIMARY KEY ("id")
);

-- §8.18 corrective_actions
CREATE TABLE "corrective_actions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "exception_id" UUID NOT NULL,
    "status" "corrective_status" NOT NULL DEFAULT 'open',
    "description" TEXT NOT NULL,
    "assignee_user_id" UUID,
    "assignee_role" "org_role",
    "due_at" TIMESTAMPTZ(6),
    "completed_by" UUID,
    "completed_at" TIMESTAMPTZ(6),
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "corrective_actions_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- exceptions
-- Open-exceptions dashboard.
CREATE INDEX "exceptions_org_status_opened_at_idx" ON "exceptions"("organization_id", "status", "opened_at");
CREATE INDEX "exceptions_org_outlet_status_idx" ON "exceptions"("organization_id", "outlet_id", "status");
CREATE INDEX "exceptions_org_task_occurrence_idx" ON "exceptions"("organization_id", "task_occurrence_id");

-- corrective_actions
-- Overdue corrective-action sweep.
CREATE INDEX "corrective_actions_org_status_due_at_idx" ON "corrective_actions"("organization_id", "status", "due_at");
CREATE INDEX "corrective_actions_org_exception_idx" ON "corrective_actions"("organization_id", "exception_id");
CREATE INDEX "corrective_actions_org_assignee_status_idx" ON "corrective_actions"("organization_id", "assignee_user_id", "status");

-- ============================================================================
-- Foreign keys (all ON DELETE RESTRICT per §8.0 — audit integrity, no cascading hard delete).
-- ============================================================================

ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_task_occurrence_id_fkey" FOREIGN KEY ("task_occurrence_id") REFERENCES "task_occurrences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_task_completion_id_fkey" FOREIGN KEY ("task_completion_id") REFERENCES "task_completions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_exception_id_fkey" FOREIGN KEY ("exception_id") REFERENCES "exceptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Row-Level Security (ENABLE + FORCE + tenant_isolation) — mirrors occurrence_domain.
-- Predicate reads transaction-local GUC app.current_org_id; unset => NULL => zero rows.
-- Mutable tables: NO append-only reject trigger (unlike activity_log / task_completions).
-- ============================================================================

ALTER TABLE "exceptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exceptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "exceptions"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "corrective_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "corrective_actions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "corrective_actions"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
