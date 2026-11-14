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

-- ------------------------------------------------------------------
-- Minimal Storage service schema.
--
-- Supabase ships these objects. The stubs let the real bucket/policy
-- migration be exercised without a live Supabase instance.
-- ------------------------------------------------------------------
create schema if not exists storage;

grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id) on delete cascade,
  name text not null,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint objects_bucket_name_unique unique (bucket_id, name)
);

alter table storage.objects enable row level security;

-- Mirrors Supabase's storage.foldername(name): all path segments except the
-- final object name.
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  select string_to_array(name, '/') into parts;
  return parts[1:array_length(parts, 1) - 1];
end;
$$;

grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects
  to anon, authenticated, service_role;
