-- activity_log tamper-evident hash chain (#13, F6). Per-org dense chain position + prev/row hashes.
--
-- The chain-COMPUTING SECURITY DEFINER function log_activity() and the sole-writer guard trigger live
-- in prisma/superuser/0001_activity_log_hash_chain.sql (applied by scripts/apply-superuser.mjs), NOT
-- here: they must be OWNED BY a superuser to bypass RLS and to run as a role other than app_user, and
-- the non-superuser app_user that runs Prisma migrations cannot create them. This migration adds only
-- the columns + index that app_user CAN create; the elevated step layers the logic on top.

ALTER TABLE "activity_log" ADD COLUMN "chain_seq" BIGINT;
ALTER TABLE "activity_log" ADD COLUMN "prev_hash" TEXT;
ALTER TABLE "activity_log" ADD COLUMN "row_hash" TEXT;

-- Per-org DENSE chain position (1,2,3,... within each org), assigned by log_activity(). A gap would
-- reveal a deleted row (append-only already forbids deletes; this is defense in depth). Partial so any
-- pre-chain / test-seeded row with a NULL chain_seq does not collide.
CREATE UNIQUE INDEX "activity_log_org_chain_seq_key"
  ON "activity_log" ("organization_id", "chain_seq")
  WHERE "chain_seq" IS NOT NULL;
