-- Milestone 1 security spine: Row-Level Security (enabled + FORCED) on every
-- tenant-scoped table, and an append-only trigger on activity_log.
--
-- Tenant predicate reads the transaction-local GUC `app.current_org_id`, set by the
-- application's withTenant() wrapper via set_config(..., true). When unset, the GUC is
-- NULL and every predicate evaluates to NULL -> zero rows (default-deny).
--
-- FORCE ROW LEVEL SECURITY makes RLS apply even to the table owner (app_user). RLS is
-- still bypassed by superusers / BYPASSRLS roles, which is exactly why the app connects
-- as app_user (NOSUPERUSER NOBYPASSRLS) and only seeding uses the superuser connection.

-- ============================================================================
-- Row-Level Security
-- ============================================================================

-- organizations: the tenant key is `id` itself.
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "organizations"
  USING ("id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- All other tenant-scoped tables key on organization_id.
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "memberships"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "invitations"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "properties" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "properties"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "outlets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outlets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "outlets"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "activity_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "activity_log"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ============================================================================
-- Append-only enforcement for activity_log (database-level, not just app-level)
-- ============================================================================

CREATE OR REPLACE FUNCTION reject_activity_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activity_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "activity_log_no_update"
  BEFORE UPDATE ON "activity_log"
  FOR EACH ROW EXECUTE FUNCTION reject_activity_log_mutation();

CREATE TRIGGER "activity_log_no_delete"
  BEFORE DELETE ON "activity_log"
  FOR EACH ROW EXECUTE FUNCTION reject_activity_log_mutation();

CREATE TRIGGER "activity_log_no_truncate"
  BEFORE TRUNCATE ON "activity_log"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_activity_log_mutation();
