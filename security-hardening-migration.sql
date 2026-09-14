-- ============================================================
-- SECURITY HARDENING — block client-side privilege escalation
-- ============================================================
--
-- The admin app historically changed a customer's role with a direct
-- browser (anon/authenticated) write to `customers`, and the deployed RLS
-- for that table was permissive/absent. That let a signed-in user run
--   supabase.from('customers').update({ role:'admin' }).eq('id', <self>)
-- from devtools and self-promote to admin.
--
-- The app has been changed to route every role change through the
-- admin-gated server API (service-role key). This trigger is the
-- defense-in-depth backstop at the database: it rejects any change to
-- `role` / `is_admin` that does NOT come from the service role (or a
-- superuser running SQL), regardless of what the client sends.
--
-- It only fires when role/is_admin actually change, so ordinary profile
-- updates (name, address, phone, etc.) from the browser are unaffected.
--
-- Safe to run more than once.

CREATE OR REPLACE FUNCTION prevent_client_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role
      OR NEW.is_admin IS DISTINCT FROM OLD.is_admin)
     -- current_user is the PostgREST-switched role: 'anon' for public and
     -- 'authenticated' for a logged-in user. The service-role key runs as
     -- 'service_role', and SQL run by the DB owner runs as a superuser —
     -- both are allowed through.
     AND current_user IN ('anon', 'authenticated')
  THEN
    RAISE EXCEPTION
      'Role/admin changes must go through the server (service role), not a client write.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_client_privilege_escalation ON customers;
CREATE TRIGGER trg_prevent_client_privilege_escalation
  BEFORE UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION prevent_client_privilege_escalation();
