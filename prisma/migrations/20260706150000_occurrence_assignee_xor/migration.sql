-- #98: task_occurrences must carry EXACTLY ONE resolved assignee — mirror the
-- scheduled_tasks_assignee_exactly_one XOR CHECK from 20260703130000_occurrence_domain.
-- Today both assignee_role and assignee_user_id may be NULL (or both set), producing an
-- unroutable occurrence. generateOccurrences snapshots the schedule's single assignee (the
-- schedule already has the XOR), so materialized occurrences already satisfy this; the CHECK
-- closes the gap for any other insert path.
--
-- The table is empty in prod (no Inngest runtime yet — see src/lib/occurrences.ts scope note),
-- so a plain validated CHECK is safe; no NOT VALID / VALIDATE split needed.
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_assignee_xor"
  CHECK (("assignee_role" IS NOT NULL) <> ("assignee_user_id" IS NOT NULL));
