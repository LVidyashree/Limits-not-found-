-- ============================================================
-- 20261114090000_archive_legacy_draft_tables.sql
--
-- EvidenceVault previously shipped a draft schema (see git history
-- for supabase_schema.sql). That draft is not the reviewed schema and
-- conflicts with it (text ids, file paths, extracted text, etc.).
--
-- This migration archives the draft tables instead of destroying
-- them. Archived tables are renamed with a _legacy_20261114 suffix,
-- keep their rows, and are fully locked down:
--   * RLS stays enabled
--   * every policy is dropped
--   * anon/authenticated privileges are revoked
--
-- On a fresh project this migration is a no-op.
-- ============================================================

begin;

-- The draft signup trigger inserts into public.profiles. Remove it while
-- the profiles table is replaced; a reviewed trigger is created later.
drop trigger if exists on_auth_user_created on auth.users;

-- Archive a table only when the draft marker is present and the
-- archive name is still free. This makes the migration safe to retry
-- after a partial failure.
create or replace function pg_temp.archive_if_legacy(
  p_table text,
  p_marker_column text,
  p_archive_name text
) returns void
language plpgsql
as $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = p_table
  )
  and not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = p_archive_name
  )
  and (
    p_marker_column is null
    or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = p_table
        and column_name = p_marker_column
    )
  ) then
    execute format('alter table public.%I rename to %I', p_table, p_archive_name);
  end if;
end;
$$;

-- profiles: the reviewed table has created_at; the draft does not.
select pg_temp.archive_if_legacy('profiles', 'created_at', 'profiles_legacy_20261114');

-- cases: the reviewed table has incident_type; the draft has category.
select pg_temp.archive_if_legacy('cases', 'incident_type', 'cases_legacy_20261114');

-- evidence: the reviewed table has encryption_version; the draft does not.
select pg_temp.archive_if_legacy('evidence', 'encryption_version', 'evidence_legacy_20261114');

-- These draft tables have no reviewed replacement.
select pg_temp.archive_if_legacy('findings', null, 'findings_legacy_20261114');
select pg_temp.archive_if_legacy('timeline_events', null, 'timeline_events_legacy_20261114');
select pg_temp.archive_if_legacy('encrypted_backups', null, 'encrypted_backups_legacy_20261114');

-- Lock down every archived table: no API access, no permissive policy.
do $$
declare
  tbl text;
  drop_sql text;
begin
  foreach tbl in array array[
    'profiles_legacy_20261114',
    'cases_legacy_20261114',
    'evidence_legacy_20261114',
    'findings_legacy_20261114',
    'timeline_events_legacy_20261114',
    'encrypted_backups_legacy_20261114'
  ]
  loop
    if exists (
      select 1 from pg_tables
      where schemaname = 'public' and tablename = tbl
    ) then
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

      execute format('revoke all on public.%I from anon, authenticated', tbl);
    end if;
  end loop;
end;
$$;

commit;
