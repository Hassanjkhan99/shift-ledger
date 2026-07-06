-- F5 keyset support (#55): index the org-wide activity_log timeline seek.
--
-- The documented keyset shape `WHERE organization_id = ? ORDER BY seq DESC LIMIT n` (the
-- §11.12 timeline / org activity feed) cannot be served in seq order by the existing
-- (organization_id, subject_type, subject_id, seq) index — that one orders per subject, so an
-- org-wide seek still degrades to a sort over the org's whole retained stream. This adds the
-- (organization_id, seq) index the seek actually needs.

CREATE INDEX "activity_log_organization_id_seq_idx" ON "activity_log" ("organization_id", "seq");
