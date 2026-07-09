-- ELEVATED (superuser) step for App entry & org routing (#132).
--
-- list_member_organizations() answers "which orgs does THIS user belong to?" — the one read the app must
-- make ACROSS tenants (to land a member on their org, or offer an org picker). `memberships` has FORCE
-- ROW LEVEL SECURITY keyed on the transaction-local GUC app.current_org_id, and the app connects as the
-- non-superuser app_user (NOBYPASSRLS): a direct `SELECT ... FROM memberships WHERE user_id = ?` with no
-- org GUC set matches ZERO rows. So a per-user enumeration is impossible for app_user without an elevated
-- helper — the eslint escape hatch only silences the coding convention, not the DB-level RLS.
--
-- This SECURITY DEFINER function is OWNED BY the superuser, so it bypasses RLS, but it is scoped by
-- construction to the CALLER'S OWN membership list: it takes p_user_id and returns only that user's
-- active, non-deleted memberships joined to non-deleted orgs — id/name/slug/role, never tenant data. The
-- app always passes the authenticated user's own id (resolved from the session), mirroring how
-- log_activity() (0001) trusts the tenant GUC. EXECUTE is granted only to app_user.
--
-- Apply with: node scripts/apply-superuser.mjs   (uses SUPERUSER_DATABASE_URL). Idempotent
-- (CREATE OR REPLACE). Runs AFTER `prisma migrate deploy`; tests invoke it from tests/global-setup.ts.

CREATE OR REPLACE FUNCTION list_member_organizations(p_user_id uuid)
RETURNS TABLE (org_id uuid, org_name text, org_slug text, role org_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- pg_temp LAST so an unqualified `memberships`/`organizations` can never resolve to a caller-created temp
-- table that shadows the real one (a SECURITY DEFINER temp-shadowing bypass); public resolves first.
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT o.id, o.name, o.slug, m.role
  FROM memberships m
  JOIN organizations o ON o.id = m.organization_id
  WHERE m.user_id = p_user_id
    AND m.status = 'active'
    AND m.deleted_at IS NULL
    AND o.deleted_at IS NULL
  ORDER BY o.name ASC, o.id ASC;
$$;

-- REVOKE the implicit PUBLIC EXECUTE first: Postgres grants EXECUTE to PUBLIC on new functions by
-- default, and this is SECURITY DEFINER (RLS-bypassing), so any OTHER login role could otherwise
-- enumerate an arbitrary user's org list. Only app_user may CALL it.
REVOKE ALL ON FUNCTION list_member_organizations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_member_organizations(uuid) TO app_user;
