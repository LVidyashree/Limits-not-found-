-- ============================================================
-- EVIDENCEVAULT — REPLACE / REPAIR ROW LEVEL SECURITY POLICIES
-- Run this in Supabase SQL Editor AFTER the tables exist.
--
-- Safe to run multiple times:
--   1. Enables RLS on each EvidenceVault table.
--   2. Drops EVERY existing policy on those tables (whatever the
--      name), so old/unknown policies cannot collide.
--   3. Recreates the correct owner-only policies.
--
-- NOTE: Do NOT touch auth.users. Supabase manages the auth schema
-- and its RLS/ownership. Only public.* tables are modified here.
-- ============================================================

-- ------------------------------------------------------------
-- STEP 1 + 2: enable RLS and drop all existing policies
-- ------------------------------------------------------------
do $$
declare
  tbl text;
  drop_sql text;
begin
  foreach tbl in array array[
    'profiles',
    'cases',
    'evidence',
    'findings',
    'timeline_events',
    'encrypted_backups'
  ]
  loop
    -- Only operate on tables that actually exist.
    if exists (
      select 1
      from pg_tables
      where schemaname = 'public'
        and tablename = tbl
    ) then
      -- Enable RLS (idempotent).
      execute format('alter table public.%I enable row level security', tbl);

      -- Build one DROP statement per existing policy on this table.
      select coalesce(
        string_agg(
          format('drop policy if exists %I on public.%I;', policyname, tbl),
          ' '
        ),
        ''
      )
      into drop_sql
      from pg_policies
      where schemaname = 'public'
        and tablename = tbl;

      if drop_sql <> '' then
        execute drop_sql;
      end if;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- STEP 3: recreate the correct policies
-- ------------------------------------------------------------

-- PROFILES (one row per auth user)
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- CASES
create policy "Users can view own cases"
  on public.cases for select
  using (auth.uid() = user_id);

create policy "Users can create own cases"
  on public.cases for insert
  with check (auth.uid() = user_id);

create policy "Users can update own cases"
  on public.cases for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own cases"
  on public.cases for delete
  using (auth.uid() = user_id);

-- EVIDENCE
create policy "Users can view own evidence"
  on public.evidence for select
  using (auth.uid() = user_id);

create policy "Users can create own evidence"
  on public.evidence for insert
  with check (auth.uid() = user_id);

create policy "Users can update own evidence"
  on public.evidence for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own evidence"
  on public.evidence for delete
  using (auth.uid() = user_id);

-- FINDINGS
create policy "Users can view own findings"
  on public.findings for select
  using (auth.uid() = user_id);

create policy "Users can create own findings"
  on public.findings for insert
  with check (auth.uid() = user_id);

create policy "Users can update own findings"
  on public.findings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own findings"
  on public.findings for delete
  using (auth.uid() = user_id);

-- TIMELINE EVENTS
create policy "Users can view own timeline"
  on public.timeline_events for select
  using (auth.uid() = user_id);

create policy "Users can create own timeline"
  on public.timeline_events for insert
  with check (auth.uid() = user_id);

create policy "Users can update own timeline"
  on public.timeline_events for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own timeline"
  on public.timeline_events for delete
  using (auth.uid() = user_id);

-- ENCRYPTED BACKUPS
create policy "Users can view own backups"
  on public.encrypted_backups for select
  using (auth.uid() = user_id);

create policy "Users can create own backups"
  on public.encrypted_backups for insert
  with check (auth.uid() = user_id);

-- Encrypted backup chunks are written once and are immutable, so no
-- UPDATE policy is needed. Add one only if you need to re-upload chunks.
create policy "Users can delete own backups"
  on public.encrypted_backups for delete
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- VERIFY (optional): list every policy that now exists
-- ------------------------------------------------------------
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
-- order by tablename, cmd;
