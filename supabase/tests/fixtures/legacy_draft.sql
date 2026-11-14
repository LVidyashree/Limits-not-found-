-- ============================================================
-- Fixture: the previously committed draft schema (supabase_schema.sql).
-- Used only by the upgrade test to prove the new migrations archive the
-- draft safely. Intentionally minimal, but keeps the marker columns,
-- policies and a permissive "allow all" policy that must be removed.
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  vault_created_at timestamptz default now(),
  biometrics_enabled boolean default false,
  updated_at timestamptz default now()
);

create table public.cases (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  title text not null,
  category text not null,
  description text,
  incident_date text not null,
  platform text not null,
  status text not null default 'active',
  created_at text not null,
  updated_at text not null
);

create table public.evidence (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  case_id text not null references public.cases on delete cascade,
  filename text not null,
  original_filename text not null,
  file_path text not null,
  file_size integer not null,
  file_type text not null,
  sha256_hash text not null,
  created_at text not null
);

create table public.findings (
  id text primary key,
  user_id uuid references auth.users on delete cascade,
  case_id text references public.cases on delete cascade
);

create table public.timeline_events (
  id text primary key,
  user_id uuid references auth.users on delete cascade,
  case_id text references public.cases on delete cascade
);

create table public.encrypted_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  case_id text references public.cases on delete cascade
);

-- Draft signup trigger.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', 'EvidenceVault User'));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Draft policies, including an intentionally over-permissive one.
alter table public.profiles enable row level security;
alter table public.cases enable row level security;
alter table public.evidence enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "legacy_allow_all_cases"
  on public.cases for select
  using (true);

create policy "legacy_allow_all_evidence"
  on public.evidence for select
  using (true);
