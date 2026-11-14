-- ============================================================
-- 20261114090300_enable_evidencevault_rls.sql
--
-- Row Level Security for the reviewed schema.
--
-- Principles:
--   * RLS is enabled on every user-owned table.
--   * Every policy is restricted to the `authenticated` role and
--     compares the row owner with auth.uid().
--   * INSERT/UPDATE policies use WITH CHECK so a user cannot create or
--     hand a row to another user (immutability triggers add defence in
--     depth for user_id/case_id).
--   * audit_events has SELECT + INSERT policies only. UPDATE/DELETE
--     privileges are revoked and a trigger blocks them for API roles.
--   * `anon` receives no table privileges at all.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Enable RLS and clear any pre-existing policies on these tables.
-- ------------------------------------------------------------
do $$
declare
  tbl text;
  drop_sql text;
begin
  foreach tbl in array array[
    'profiles', 'cases', 'evidence', 'incident_reports', 'audit_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', tbl);

    select coalesce(
      string_agg(
        format('drop policy if exists %I on public.%I;', policyname, tbl),
        ' '
      ),
      ''
    )
    into drop_sql
    from pg_policies
    where schemaname = 'public' and tablename = tbl;

    if drop_sql <> '' then
      execute drop_sql;
    end if;
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 2. Profiles: read/update your own minimal profile.
--    Rows are normally created by the signup trigger.
-- ------------------------------------------------------------
create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy profiles_insert_own
  on public.profiles for insert
  to authenticated
  with check (id = (select auth.uid()));

create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ------------------------------------------------------------
-- 3. Cases
-- ------------------------------------------------------------
create policy cases_select_own
  on public.cases for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy cases_insert_own
  on public.cases for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy cases_update_own
  on public.cases for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy cases_delete_own
  on public.cases for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------------------------------------
-- 4. Evidence
-- ------------------------------------------------------------
create policy evidence_select_own
  on public.evidence for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy evidence_insert_own
  on public.evidence for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy evidence_update_own
  on public.evidence for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy evidence_delete_own
  on public.evidence for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------------------------------------
-- 5. Incident reports
-- ------------------------------------------------------------
create policy incident_reports_select_own
  on public.incident_reports for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy incident_reports_insert_own
  on public.incident_reports for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy incident_reports_update_own
  on public.incident_reports for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy incident_reports_delete_own
  on public.incident_reports for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------------------------------------
-- 6. Audit events: append-only for API roles.
--    The insert trigger validates case/evidence ownership.
-- ------------------------------------------------------------
create policy audit_events_select_own
  on public.audit_events for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy audit_events_insert_own
  on public.audit_events for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- ------------------------------------------------------------
-- 7. Privileges
--
-- Supabase grants broad privileges to anon/authenticated by default.
-- Remove them and grant only the operations the app needs.
-- ------------------------------------------------------------
revoke all on public.profiles, public.cases, public.evidence,
  public.incident_reports, public.audit_events
  from anon, authenticated, public;

grant usage on schema public to authenticated;

grant select, insert, update on public.profiles to authenticated;

grant select, insert, update, delete on public.cases to authenticated;
grant select, insert, update, delete on public.evidence to authenticated;
grant select, insert, update, delete on public.incident_reports to authenticated;

grant select, insert on public.audit_events to authenticated;

-- Defence in depth: TRUNCATE is never granted to API roles.
revoke truncate on public.profiles, public.cases, public.evidence,
  public.incident_reports, public.audit_events
  from anon, authenticated;

-- ------------------------------------------------------------
-- 8. Ask PostgREST to refresh its schema cache.
-- ------------------------------------------------------------
notify pgrst, 'reload schema';

commit;
