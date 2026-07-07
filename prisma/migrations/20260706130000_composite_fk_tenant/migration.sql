-- Composite (tenant-qualified) foreign keys (#94). Additive DDL only — no row updates, so the
-- append-only INSERT-only triggers on task_completions / evidence are unaffected.
--
-- Problem: the M2 cross-row FKs are single-column (e.g. task_occurrences.property_id ->
-- properties.id). Postgres evaluates FK checks as the table owner and BYPASSES RLS, so a caller
-- operating under withTenant(orgA) can persist a child row tagged organization_id = orgA that
-- references a PARENT row belonging to orgB — a cross-tenant reference the RLS SELECT policy would
-- otherwise hide. WITH CHECK on the child only proves the child's own org tag, not the parent's.
--
-- Fix: rewrite each cross-row FK as a COMPOSITE key on (organization_id, <ref_id>) referencing the
-- parent's (organization_id, id). Because the child row carries organization_id = orgA, the FK can
-- only resolve to a parent row that ALSO has organization_id = orgA — a cross-tenant reference has
-- no matching target and is rejected at the constraint level, independent of RLS.
--
-- These composite FKs are DB-level integrity constraints only. Prisma's @relation definitions stay
-- SINGLE-COLUMN (queries use the scalar _id fields); the composite shape is intentionally NOT modeled
-- in schema.prisma, mirroring the partial index / CHECK constraints that also live only in migrations.
-- `prisma migrate dev` drift against these is therefore expected/known.
--
-- FKs to `organizations` and the global `users` table are deliberately left single-column.
-- Self / nullable references (task_completions.supersedes_id, exceptions.task_completion_id) use the
-- default MATCH SIMPLE semantics: if any FK column is NULL the constraint is not enforced, so NULLs
-- remain allowed.

-- ============================================================================
-- 1. UNIQUE (organization_id, id) on every parent that will be referenced compositely.
--    Redundant with the PK on id, but required as the target of a composite FK.
-- ============================================================================
ALTER TABLE "properties"       ADD CONSTRAINT "properties_org_id_key"       UNIQUE ("organization_id", "id");
ALTER TABLE "outlets"          ADD CONSTRAINT "outlets_org_id_key"          UNIQUE ("organization_id", "id");
ALTER TABLE "task_templates"   ADD CONSTRAINT "task_templates_org_id_key"   UNIQUE ("organization_id", "id");
ALTER TABLE "scheduled_tasks"  ADD CONSTRAINT "scheduled_tasks_org_id_key"  UNIQUE ("organization_id", "id");
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_org_id_key" UNIQUE ("organization_id", "id");
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_org_id_key" UNIQUE ("organization_id", "id");
ALTER TABLE "exceptions"       ADD CONSTRAINT "exceptions_org_id_key"       UNIQUE ("organization_id", "id");

-- ============================================================================
-- 2. Convert cross-row child FKs to composite (organization_id, <ref_id>) -> parent(organization_id, id).
--    Each keeps its ORIGINAL constraint name and the ON DELETE RESTRICT / ON UPDATE CASCADE actions.
-- ============================================================================

-- scheduled_tasks
ALTER TABLE "scheduled_tasks" DROP CONSTRAINT "scheduled_tasks_property_id_fkey";
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_tasks" DROP CONSTRAINT "scheduled_tasks_outlet_id_fkey";
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_outlet_id_fkey" FOREIGN KEY ("organization_id", "outlet_id") REFERENCES "outlets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_tasks" DROP CONSTRAINT "scheduled_tasks_task_template_id_fkey";
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_task_template_id_fkey" FOREIGN KEY ("organization_id", "task_template_id") REFERENCES "task_templates"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- task_occurrences
ALTER TABLE "task_occurrences" DROP CONSTRAINT "task_occurrences_property_id_fkey";
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_occurrences" DROP CONSTRAINT "task_occurrences_outlet_id_fkey";
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_outlet_id_fkey" FOREIGN KEY ("organization_id", "outlet_id") REFERENCES "outlets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_occurrences" DROP CONSTRAINT "task_occurrences_scheduled_task_id_fkey";
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_scheduled_task_id_fkey" FOREIGN KEY ("organization_id", "scheduled_task_id") REFERENCES "scheduled_tasks"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_occurrences" DROP CONSTRAINT "task_occurrences_task_template_id_fkey";
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_task_template_id_fkey" FOREIGN KEY ("organization_id", "task_template_id") REFERENCES "task_templates"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- task_completions (task_occurrence_id; supersedes_id is a nullable self-reference)
ALTER TABLE "task_completions" DROP CONSTRAINT "task_completions_task_occurrence_id_fkey";
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_task_occurrence_id_fkey" FOREIGN KEY ("organization_id", "task_occurrence_id") REFERENCES "task_occurrences"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_completions" DROP CONSTRAINT "task_completions_supersedes_id_fkey";
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_supersedes_id_fkey" FOREIGN KEY ("organization_id", "supersedes_id") REFERENCES "task_completions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- evidence
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_task_completion_id_fkey";
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_task_completion_id_fkey" FOREIGN KEY ("organization_id", "task_completion_id") REFERENCES "task_completions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- exceptions (task_completion_id is nullable)
ALTER TABLE "exceptions" DROP CONSTRAINT "exceptions_property_id_fkey";
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_property_id_fkey" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exceptions" DROP CONSTRAINT "exceptions_outlet_id_fkey";
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_outlet_id_fkey" FOREIGN KEY ("organization_id", "outlet_id") REFERENCES "outlets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exceptions" DROP CONSTRAINT "exceptions_task_occurrence_id_fkey";
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_task_occurrence_id_fkey" FOREIGN KEY ("organization_id", "task_occurrence_id") REFERENCES "task_occurrences"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exceptions" DROP CONSTRAINT "exceptions_task_completion_id_fkey";
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_task_completion_id_fkey" FOREIGN KEY ("organization_id", "task_completion_id") REFERENCES "task_completions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- corrective_actions
ALTER TABLE "corrective_actions" DROP CONSTRAINT "corrective_actions_exception_id_fkey";
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_exception_id_fkey" FOREIGN KEY ("organization_id", "exception_id") REFERENCES "exceptions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
