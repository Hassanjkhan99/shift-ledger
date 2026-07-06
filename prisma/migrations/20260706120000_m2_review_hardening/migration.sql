-- M2 post-merge review hardening (#93, Codex round 3). Additive changes only — the earlier M2
-- migrations are already merged/applied, so these are new ALTERs rather than edits.

-- task_occurrences.config_snapshot (§8.13): freeze the template's threshold / required-evidence
-- config onto each occurrence at generation time, so a later template edit cannot re-judge a
-- historical occurrence. Nullable — the generator populates it; existing rows (none in prod) stay null.
ALTER TABLE "task_occurrences" ADD COLUMN "config_snapshot" JSONB;

-- task_completions: a correction version (version > 1) must carry a NON-BLANK edit_reason. The
-- existing biconditional CHECK only requires edit_reason IS NOT NULL; this rejects whitespace-only
-- reasons so the audit rationale for changing a compliance record is always meaningful.
ALTER TABLE "task_completions"
  ADD CONSTRAINT "task_completions_edit_reason_nonblank"
  CHECK ("version" = 1 OR btrim("edit_reason") <> '');
