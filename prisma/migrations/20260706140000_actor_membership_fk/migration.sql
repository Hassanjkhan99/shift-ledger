-- Actor/assignee tenant-membership foreign keys (#95). Additive DDL only — no row updates, so the
-- append-only INSERT-only triggers on task_completions are unaffected.
--
-- Problem: the assignee/actor user columns on the tenant-scoped tables are FK-checked ONLY against
-- the GLOBAL `users` table. `users` is not tenant-scoped, so nothing at the DB level stops a row in
-- org A from naming a user who belongs to a DIFFERENT org (or no org at all) as its assignee/actor.
-- Postgres evaluates FK checks as the table owner and BYPASSES RLS, so the single-column users FK
-- cannot express "must be a member of THIS row's org".
--
-- Fix: add a COMPOSITE FK on (organization_id, <actor_col>) referencing
-- memberships(organization_id, user_id) for each actor column. `memberships` already carries the
-- UNIQUE(organization_id, user_id) index (memberships_organization_id_user_id_key), so the composite
-- key can only resolve to a membership row that ALSO has organization_id = this row's org — i.e. the
-- named user must be a member of the SAME org. A cross-tenant or non-member user id has no matching
-- target and is rejected at the constraint level, independent of RLS.
--
-- These are DB-level INTEGRITY constraints only (existence of an in-org membership). We KEEP the
-- existing single-column FKs to `users` (identity) too — this is purely additive. Nullable actor
-- columns keep the default MATCH SIMPLE semantics: if the actor column is NULL the composite FK is
-- not enforced, so NULL stays allowed. task_completions.completed_by is NOT NULL — every completion
-- always names an in-org actor.
--
-- The ACTIVE / non-deleted membership check (status = 'active', deleted_at IS NULL) CANNOT be an FK
-- (an FK can only prove existence, not a filtered predicate); it is enforced at the app write layer
-- where each write path lives (see src/lib/exceptions.ts assignCorrectiveAction; completion actors
-- are already validated by resolveCompletionActor / isEligiblePickUser). As with the composite
-- tenant FKs (#94) and the CHECK constraints, these composite FKs live ONLY in this migration; the
-- Prisma @relation definitions stay SINGLE-COLUMN to `users`, so `prisma migrate dev` drift against
-- them is expected/known.

-- scheduled_tasks.assignee_user_id
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_assignee_membership_fkey" FOREIGN KEY ("organization_id", "assignee_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- task_completions.completed_by (NOT NULL — a completion always has an in-org actor)
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_completed_by_membership_fkey" FOREIGN KEY ("organization_id", "completed_by") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- exceptions.opened_by
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_opened_by_membership_fkey" FOREIGN KEY ("organization_id", "opened_by") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- corrective_actions.assignee_user_id / completed_by / verified_by
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_assignee_membership_fkey" FOREIGN KEY ("organization_id", "assignee_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_completed_by_membership_fkey" FOREIGN KEY ("organization_id", "completed_by") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_verified_by_membership_fkey" FOREIGN KEY ("organization_id", "verified_by") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
