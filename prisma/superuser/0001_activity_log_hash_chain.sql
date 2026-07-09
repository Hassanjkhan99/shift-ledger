-- ELEVATED (superuser) migration step for the activity_log hash chain (#13, F6).
--
-- Why this is separate from the Prisma migrations: Prisma migrations run as the non-superuser app_user
-- (so RLS applies to the app). The chain must be UNFORGEABLE by application code, which needs two things
-- app_user cannot create for itself:
--   1. A SECURITY DEFINER function OWNED BY a superuser, so it runs as that superuser and BYPASSES RLS
--      to read the org's prior chain head and append the next linked row atomically. app_user can only
--      call it (EXECUTE), never reproduce its privileged body.
--   2. A BEFORE INSERT guard that rejects any direct app_user insert, so log_activity() is the SOLE
--      writer. Because the function runs as its superuser owner, current_user inside it is NOT app_user
--      and the guard lets it through; a direct Prisma insert (current_user = app_user) is rejected.
--
-- Apply with: node scripts/apply-superuser.mjs   (uses SUPERUSER_DATABASE_URL). Idempotent.
-- The columns (chain_seq/prev_hash/row_hash) + unique index are added by the ordinary Prisma migration
-- 20260707140000_activity_log_hash_chain; this step layers the privileged logic on top.

-- ============================================================================
-- log_activity() - the single, unforgeable append path. Derives the org from the same
-- transaction-local GUC RLS uses (app.current_org_id), so a caller can only ever append to its OWN
-- org's chain even though the function bypasses RLS.
-- ============================================================================
CREATE OR REPLACE FUNCTION log_activity(
  p_organization_id uuid,
  p_subject_type activity_subject_type,
  p_subject_id uuid,
  p_action text,
  p_actor_user_id uuid,
  p_actor_label text,
  p_before jsonb,
  p_after jsonb,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
-- pg_temp LAST so an unqualified `activity_log` can never resolve to a caller-created temp table that
-- shadows the real one (a SECURITY DEFINER temp-shadowing bypass); public resolves first.
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org uuid := nullif(current_setting('app.current_org_id', true), '')::uuid;
  v_prev text;
  v_seq bigint;
  v_id uuid := uuidv7();
  v_payload text;
  v_hash text;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'log_activity: no tenant context (app.current_org_id unset)';
  END IF;
  -- The caller's claimed org MUST match the tenant context. The row is always written under the GUC
  -- org (v_org); a mismatch means the caller tried to attribute the log to a different tenant, which
  -- must fail the whole transaction (mirrors the activity_log RLS WITH CHECK the direct path enforced).
  IF p_organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'log_activity: organization mismatch (claimed %, tenant context %)', p_organization_id, v_org;
  END IF;
  -- Exactly one actor (mirrors logActivity()'s TS check). This function is the DB-sanctioned append API
  -- granted to app_user, so it must also reject unattributed/ambiguous rows from any raw-SQL caller.
  IF (p_actor_user_id IS NOT NULL) = (p_actor_label IS NOT NULL AND btrim(p_actor_label) <> '') THEN
    RAISE EXCEPTION 'log_activity: exactly one of actor_user_id / actor_label (non-blank) is required';
  END IF;

  -- Serialize this org's chain so concurrent appends link deterministically (per-org, not global).
  PERFORM pg_advisory_xact_lock(hashtext('activity_log_chain'), hashtext(v_org::text));

  SELECT row_hash, chain_seq INTO v_prev, v_seq
    FROM activity_log
   WHERE organization_id = v_org AND chain_seq IS NOT NULL
   ORDER BY chain_seq DESC
   LIMIT 1;
  v_seq := coalesce(v_seq, 0) + 1;

  -- Canonical payload (chr(31) = unit separator, unambiguous). row_hash = H(prev || canonical(row)).
  v_payload := coalesce(v_prev, '') || chr(31) || v_id::text || chr(31) || v_org::text || chr(31)
    || p_subject_type::text || chr(31) || p_subject_id::text || chr(31) || p_action || chr(31)
    || coalesce(p_actor_user_id::text, '') || chr(31) || coalesce(p_actor_label, '') || chr(31)
    || coalesce(p_before::text, '') || chr(31) || coalesce(p_after::text, '') || chr(31)
    || coalesce(p_reason, '') || chr(31) || v_seq::text;
  v_hash := encode(sha256(convert_to(v_payload, 'UTF8')), 'hex');

  INSERT INTO activity_log
    (id, organization_id, subject_type, subject_id, action, actor_user_id, actor_label,
     before_json, after_json, reason, chain_seq, prev_hash, row_hash)
  VALUES
    (v_id, v_org, p_subject_type, p_subject_id, p_action, p_actor_user_id, p_actor_label,
     p_before, p_after, p_reason, v_seq, v_prev, v_hash);

  RETURN v_id;
END;
$$;

-- ============================================================================
-- verify_activity_chain() - recompute the current org's chain from stored fields and confirm every
-- prev/row hash links and matches. Returns false if any row was reordered, unlinked, or altered.
-- ============================================================================
CREATE OR REPLACE FUNCTION verify_activity_chain() RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
-- pg_temp LAST so an unqualified `activity_log` can never resolve to a caller-created temp table that
-- shadows the real one (a SECURITY DEFINER temp-shadowing bypass); public resolves first.
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org uuid := nullif(current_setting('app.current_org_id', true), '')::uuid;
  r record;
  v_prev text := NULL;
  v_payload text;
  v_calc text;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'verify_activity_chain: no tenant context';
  END IF;
  FOR r IN
    SELECT * FROM activity_log
     WHERE organization_id = v_org AND chain_seq IS NOT NULL
     ORDER BY chain_seq ASC
  LOOP
    IF r.prev_hash IS DISTINCT FROM v_prev THEN
      RETURN false; -- broken linkage (reorder / missing predecessor)
    END IF;
    v_payload := coalesce(v_prev, '') || chr(31) || r.id::text || chr(31) || r.organization_id::text
      || chr(31) || r.subject_type::text || chr(31) || r.subject_id::text || chr(31) || r.action
      || chr(31) || coalesce(r.actor_user_id::text, '') || chr(31) || coalesce(r.actor_label, '')
      || chr(31) || coalesce(r.before_json::text, '') || chr(31) || coalesce(r.after_json::text, '')
      || chr(31) || coalesce(r.reason, '') || chr(31) || r.chain_seq::text;
    v_calc := encode(sha256(convert_to(v_payload, 'UTF8')), 'hex');
    IF v_calc IS DISTINCT FROM r.row_hash THEN
      RETURN false; -- altered content: recomputed hash no longer matches the stored one
    END IF;
    v_prev := r.row_hash;
  END LOOP;
  RETURN true;
END;
$$;

-- ============================================================================
-- activity_chain_head() - the current org's latest row_hash (audit packs record it as chain_head_hash
-- to prove scope integrity at export time, #14). Null when the org has no chained rows yet.
-- ============================================================================
CREATE OR REPLACE FUNCTION activity_chain_head() RETURNS text
LANGUAGE sql
SECURITY DEFINER
-- pg_temp LAST so an unqualified `activity_log` can never resolve to a caller-created temp table that
-- shadows the real one (a SECURITY DEFINER temp-shadowing bypass); public resolves first.
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT row_hash FROM activity_log
   WHERE organization_id = nullif(current_setting('app.current_org_id', true), '')::uuid
     AND chain_seq IS NOT NULL
   ORDER BY chain_seq DESC
   LIMIT 1;
$$;

-- ============================================================================
-- Sole-writer guard: reject any DIRECT app_user insert so log_activity() is the only append path.
-- log_activity() runs as its superuser owner, so current_user there is NOT app_user and passes.
-- ============================================================================
CREATE OR REPLACE FUNCTION activity_log_enforce_writer() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'app_user' THEN
    RAISE EXCEPTION 'activity_log: direct insert is not permitted; use log_activity()'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS activity_log_enforce_writer ON activity_log;
CREATE TRIGGER activity_log_enforce_writer
  BEFORE INSERT ON activity_log
  FOR EACH ROW EXECUTE FUNCTION activity_log_enforce_writer();

-- REVOKE the implicit PUBLIC EXECUTE first: Postgres grants EXECUTE to PUBLIC on new functions by
-- default, and these are SECURITY DEFINER (RLS-bypassing), so any OTHER login role could otherwise set
-- app.current_org_id and append/read a tenant's audit chain. Only app_user may CALL them.
REVOKE ALL ON FUNCTION log_activity(uuid, activity_subject_type, uuid, text, uuid, text, jsonb, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION verify_activity_chain() FROM PUBLIC;
REVOKE ALL ON FUNCTION activity_chain_head() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_activity(uuid, activity_subject_type, uuid, text, uuid, text, jsonb, jsonb, text) TO app_user;
GRANT EXECUTE ON FUNCTION verify_activity_chain() TO app_user;
GRANT EXECUTE ON FUNCTION activity_chain_head() TO app_user;
