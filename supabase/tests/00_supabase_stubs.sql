-- ============================================================
-- Local Supabase-compatible stubs for RLS tests.
--
-- Supabase provides the auth schema, the auth.uid() function and the
-- anon/authenticated/service_role roles. This file recreates the parts
-- the migrations depend on so the exact migration SQL can be tested
-- against a plain PostgreSQL server.
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'create role anon nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'create role authenticated nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'create role service_role nologin bypassrls';
  end if;
end;
$$;

create schema if not exists auth;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Mirrors Supabase's auth.uid(): reads the JWT subject from the
-- request.jwt.claim.sub GUC (as PostgREST sets it) or from a claims JSON.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;
