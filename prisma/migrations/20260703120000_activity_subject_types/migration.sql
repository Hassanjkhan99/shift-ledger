-- Extend activity_subject_type to the full §8.20 subject set (issue #54, F4).
--
-- The transition() choke point is generic over subject_type, so the enum must carry every
-- entity kind that can transition — even though several of the backing tables (task_template,
-- scheduled_task, task_occurrence, task_completion, evidence, exception, corrective_action,
-- export_job, notification) land in later milestones. Adding the labels now keeps transition()
-- callers from having to co-schedule an enum migration when their table arrives.
--
-- ADD VALUE IF NOT EXISTS is idempotent (safe re-run). PG18 permits ADD VALUE inside the
-- migration transaction because none of these new values is *used* (referenced in a query or
-- default) within the same migration — they are only declared here.

ALTER TYPE "activity_subject_type" ADD VALUE IF NOT EXISTS 'task_template';
ALTER TYPE "activity_subject_type" ADD VALUE IF NOT EXISTS 'scheduled_task';
ALTER TYPE "activity_subject_type" ADD VALUE IF NOT EXISTS 'task_occurrence';
ALTER TYPE "activity_subject_type" ADD VALUE IF NOT EXISTS 'task_completion';
ALTER TYPE "activity_subject_type" ADD VALUE IF NOT EXISTS 'evidence';
ALTER TYPE "activity_subject_type" ADD VALUE IF NOT EXISTS 'exception';
ALTER TYPE "activity_subject_type" ADD VALUE IF NOT EXISTS 'corrective_action';
ALTER TYPE "activity_subject_type" ADD VALUE IF NOT EXISTS 'export_job';
ALTER TYPE "activity_subject_type" ADD VALUE IF NOT EXISTS 'notification';
